import type { FileBasedBackend } from '../../../src/types.js'
import { describe, expect, it, vi } from 'vitest'
import { AgentBackendMCPServer } from '../../../src/server/AgentBackendMCPServer.js'
import { createUnifiedDiff, DEFAULT_DIFF_BUDGET } from '../../../src/server/tools.js'

interface ToolEntry {
  name: string
  description: string
  inputSchema: unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any, ctx: { sessionId?: string }) => Promise<{ content: Array<{ type: string, text: string }> }>
}

function makeBackend(overrides: Partial<FileBasedBackend> = {}): FileBasedBackend {
  const base = {
    type: 'LocalFilesystem',
    rootDir: '/ws',
    connected: true,
    read: vi.fn(),
    write: vi.fn().mockResolvedValue(undefined),
    readdir: vi.fn(),
    mkdir: vi.fn(),
    exists: vi.fn(),
    stat: vi.fn(),
    exec: vi.fn(),
    touch: vi.fn(),
    scope: vi.fn(),
    listActiveScopes: vi.fn().mockResolvedValue([]),
    getMCPClient: vi.fn(),
    destroy: vi.fn(),
  }
  return { ...base, ...overrides } as unknown as FileBasedBackend
}

function tool(backend: FileBasedBackend, name: string): ToolEntry {
  const server = new AgentBackendMCPServer(backend)
  const found = server.server.getTools()[name]
  if (!found) throw new Error(`tool not registered: ${name}`)
  return found as unknown as ToolEntry
}

// ─────────────────────────────────────────────────────────────────
// edit_file
// ─────────────────────────────────────────────────────────────────

describe('edit_file — uniqueness + replaceAll', () => {
  it('applies a single edit when oldText is unique', async () => {
    const backend = makeBackend({
      read: vi.fn().mockResolvedValue('hello world\ngoodbye moon\n'),
    })
    const t = tool(backend, 'edit_file')
    const result = await t.handler(
      { path: 'a.txt', edits: [{ oldText: 'hello world', newText: 'HELLO WORLD' }] },
      {},
    )
    expect(backend.write).toHaveBeenCalledWith('a.txt', 'HELLO WORLD\ngoodbye moon\n')
    expect(result.content[0].text).toContain('-hello world')
    expect(result.content[0].text).toContain('+HELLO WORLD')
  })

  it('throws when oldText appears multiple times and replaceAll is not set', async () => {
    const backend = makeBackend({
      read: vi.fn().mockResolvedValue('foo\nfoo\nfoo\n'),
    })
    const t = tool(backend, 'edit_file')
    await expect(
      t.handler({ path: 'a.txt', edits: [{ oldText: 'foo', newText: 'bar' }] }, {}),
    ).rejects.toThrow(/appears 3 times/)
    expect(backend.write).not.toHaveBeenCalled()
  })

  it('replaces every occurrence when replaceAll is true', async () => {
    const backend = makeBackend({
      read: vi.fn().mockResolvedValue('foo\nfoo\nfoo\n'),
    })
    const t = tool(backend, 'edit_file')
    await t.handler(
      { path: 'a.txt', edits: [{ oldText: 'foo', newText: 'bar', replaceAll: true }] },
      {},
    )
    expect(backend.write).toHaveBeenCalledWith('a.txt', 'bar\nbar\nbar\n')
  })

  it('throws when oldText is not found', async () => {
    const backend = makeBackend({
      read: vi.fn().mockResolvedValue('hello\n'),
    })
    const t = tool(backend, 'edit_file')
    await expect(
      t.handler({ path: 'a.txt', edits: [{ oldText: 'nope', newText: 'x' }] }, {}),
    ).rejects.toThrow(/could not find exact match/)
  })

  it('applies edits sequentially; each sees prior results', async () => {
    const backend = makeBackend({
      read: vi.fn().mockResolvedValue('alpha\nbeta\n'),
    })
    const t = tool(backend, 'edit_file')
    await t.handler(
      {
        path: 'a.txt',
        edits: [
          { oldText: 'alpha', newText: 'ALPHA' },
          { oldText: 'ALPHA\nbeta', newText: 'ALPHA\nBETA' },
        ],
      },
      {},
    )
    expect(backend.write).toHaveBeenCalledWith('a.txt', 'ALPHA\nBETA\n')
  })

  it('dryRun returns the diff without writing', async () => {
    const backend = makeBackend({
      read: vi.fn().mockResolvedValue('foo\n'),
    })
    const t = tool(backend, 'edit_file')
    const result = await t.handler(
      { path: 'a.txt', edits: [{ oldText: 'foo', newText: 'bar' }], dryRun: true },
      {},
    )
    expect(backend.write).not.toHaveBeenCalled()
    expect(result.content[0].text.startsWith('[DRY RUN]')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────
// edit_file — diff rendering
//
// Regression coverage for a hang: the previous hand-rolled differ could leave
// both cursors parked and spin forever at 100% CPU, blocking the daemon's only
// thread for every session it served. Every test here is time-bounded so a
// regression fails the suite instead of hanging it.
// ─────────────────────────────────────────────────────────────────

describe('edit_file — diff rendering terminates', () => {
  const line = (n: number) => `  "field${n}": "value${n}",`

  it('renders an adjacent transposition instead of spinning', () => {
    // The minimal non-terminating input for the old differ: "B" reappears within
    // 10 lines on the modified side and "C" within 10 on the original side, so
    // neither of its lookahead heuristics would advance its cursor.
    const result = createUnifiedDiff(
      ['a', 'B', 'C', 'z'].join('\n'),
      ['a', 'C', 'B', 'z'].join('\n'),
      'f.txt',
    )
    expect(result.degraded).toBe(false)
    expect(result.text).toContain('@@')
    // The move is rendered as the minimal edit: B is lifted past C, which stays
    // as context. The old differ produced no output at all here.
    expect(result.text).toMatch(/^-B$/m)
    expect(result.text).toMatch(/^\+B$/m)
    expect(result.text).toMatch(/^ C$/m)
  }, 5000)

  it('renders a reorder inside repeated boilerplate', () => {
    // Structured text with recurring lines ("},", '"type": "string"') is what
    // made this fire readily in practice.
    const block = (name: string) => [
      '    {',
      `      "name": "${name}",`,
      '      "type": "string",',
      '      "required": true',
      '    },',
    ]
    const original = [...block('alpha'), ...block('beta'), ...block('gamma')].join('\n')
    const modified = [...block('alpha'), ...block('gamma'), ...block('beta')].join('\n')

    const result = createUnifiedDiff(original, modified, 'schema.json')
    expect(result.degraded).toBe(false)
    expect(result.text).toContain('--- schema.json')
    expect(result.text).toContain('+++ schema.json')
    expect(result.text).toContain('"name": "gamma"')
  }, 5000)

  it('diffs a 1300-line file well inside the budget', () => {
    // The size that hung the daemon in the field. A correct differ is ~1ms here,
    // so the budget should never come near being consulted.
    const original = Array.from({ length: 1320 }, (_, n) => line(n)).join('\n')
    const modified = original
      .replace(line(3), '  "field3": "CHANGED",')
      .replace(line(900), '  "field900": "ALSO CHANGED",')

    const start = Date.now()
    const result = createUnifiedDiff(original, modified, 'big.json')
    const elapsed = Date.now() - start

    expect(result.degraded).toBe(false)
    expect(elapsed).toBeLessThan(DEFAULT_DIFF_BUDGET.timeoutMs)
    expect(result.text).toContain('+  "field3": "CHANGED",')
    expect(result.text).toContain('+  "field900": "ALSO CHANGED",')
    // Two isolated changes 900 lines apart belong in separate hunks.
    expect(result.text.match(/^@@/gm)?.length).toBe(2)
  }, 5000)

  it('emits no hunks when the content is unchanged', () => {
    const result = createUnifiedDiff('a\nb\n', 'a\nb\n', 'f.txt')
    expect(result.degraded).toBe(false)
    expect(result.text).not.toContain('@@')
  }, 5000)

  it('reports every edit through the tool handler without hanging', async () => {
    const backend = makeBackend({
      read: vi.fn().mockResolvedValue('a\nB\nC\nz\n'),
    })
    const t = tool(backend, 'edit_file')
    const result = await t.handler(
      { path: 'a.txt', edits: [{ oldText: 'B\nC', newText: 'C\nB' }] },
      {},
    )
    expect(backend.write).toHaveBeenCalledWith('a.txt', 'a\nC\nB\nz\n')
    expect(result.content[0].text).toContain('@@')
  }, 5000)
})

describe('edit_file — diff budget', () => {
  it('degrades instead of throwing when the edit-length cap is hit', () => {
    // maxEditLength 1 cannot cover a substitution (one delete + one insert).
    const result = createUnifiedDiff('a\nb\nc\n', 'a\nCHANGED\nc\n', 'f.txt', {
      timeoutMs: DEFAULT_DIFF_BUDGET.timeoutMs,
      maxEditLength: 1,
    })
    expect(result.degraded).toBe(true)
    expect(result.text).toContain('--- f.txt')
    expect(result.text).toContain('+++ f.txt')
    expect(result.text).toContain('[diff omitted:')
    expect(result.text).toContain('1 line edits')
    expect(result.text).toContain('4 to 4 lines')
  }, 5000)

  it('degrades instead of throwing when the deadline has passed', () => {
    // A deadline already in the past — the budget is checked inside the diff
    // loop, so it aborts on the first iteration rather than running to
    // completion the way an external timeout would have to.
    const result = createUnifiedDiff('a\nb\n', 'a\nc\n', 'f.txt', {
      timeoutMs: -1,
      maxEditLength: DEFAULT_DIFF_BUDGET.maxEditLength,
    })
    expect(result.degraded).toBe(true)
    expect(result.text).toContain('[diff omitted:')
  }, 5000)

  // The handler's behaviour when the budget is breached is covered in
  // edit-file-diff-budget.test.ts, which stubs the renderer to force it.
})

// ─────────────────────────────────────────────────────────────────
// search_files
// ─────────────────────────────────────────────────────────────────

describe('search_files — mtime sorting', () => {
  function mkStat(isDir: boolean, mtimeMs: number) {
    return {
      isFile: () => !isDir,
      isDirectory: () => isDir,
      size: 0,
      mtime: new Date(mtimeMs),
      atime: new Date(0),
      birthtime: new Date(0),
      mode: 0o644,
    }
  }

  it('sorts by path alphabetically by default', async () => {
    const backend = makeBackend({
      readdir: vi.fn().mockImplementation(async (p: string) => {
        if (p === 'src') return ['z.ts', 'a.ts', 'm.ts']
        return []
      }),
      stat: vi.fn().mockImplementation(async (p: string) => mkStat(false, p.length)),
    })
    const t = tool(backend, 'search_files')
    const result = await t.handler(
      { path: 'src', pattern: '*.ts' },
      {},
    )
    const lines = result.content[0].text.split('\n')
    expect(lines).toEqual(['src/a.ts', 'src/m.ts', 'src/z.ts'])
  })

  it('sorts by mtime descending when sortBy: "mtime"', async () => {
    const now = 1_700_000_000_000
    const mtimes: Record<string, number> = {
      'src/old.ts': now - 100_000,
      'src/new.ts': now,
      'src/middle.ts': now - 50_000,
    }
    const backend = makeBackend({
      readdir: vi.fn().mockImplementation(async (p: string) => {
        if (p === 'src') return ['old.ts', 'new.ts', 'middle.ts']
        return []
      }),
      stat: vi.fn().mockImplementation(async (p: string) => {
        const isDir = p === 'src'
        return mkStat(isDir, mtimes[p] ?? 0)
      }),
    })
    const t = tool(backend, 'search_files')
    const result = await t.handler(
      { path: 'src', pattern: '*.ts', sortBy: 'mtime' },
      {},
    )
    expect(result.content[0].text.split('\n')).toEqual([
      'src/new.ts',
      'src/middle.ts',
      'src/old.ts',
    ])
  })

  it('returns a friendly message when nothing matches', async () => {
    const backend = makeBackend({
      readdir: vi.fn().mockResolvedValue([]),
      stat: vi.fn(),
    })
    const t = tool(backend, 'search_files')
    const result = await t.handler({ path: '.', pattern: '*.xyz' }, {})
    expect(result.content[0].text).toBe('No matches found')
  })
})

// ─────────────────────────────────────────────────────────────────
// grep
// ─────────────────────────────────────────────────────────────────

describe('grep — ripgrep shell-out', () => {
  it('builds a files_with_matches command by default', async () => {
    const exec = vi.fn().mockResolvedValue('src/a.ts\nsrc/b.ts')
    const backend = makeBackend({ exec })
    const t = tool(backend, 'grep')
    const result = await t.handler({ pattern: 'foo' }, {})

    expect(exec).toHaveBeenCalledTimes(1)
    const cmd = exec.mock.calls[0][0] as string
    expect(cmd).toMatch(/^rg /)
    expect(cmd).toContain("'-l'")
    expect(cmd).toContain("'--' 'foo'")
    expect(cmd).toContain('|| [ $? -eq 1 ]')
    expect(result.content[0].text).toBe('src/a.ts\nsrc/b.ts')
  })

  it('passes case-insensitive, multiline, context, and glob flags', async () => {
    const exec = vi.fn().mockResolvedValue('')
    const backend = makeBackend({ exec })
    const t = tool(backend, 'grep')
    await t.handler({
      pattern: 'foo',
      path: 'src',
      glob: '*.ts',
      outputMode: 'content',
      caseInsensitive: true,
      multiline: true,
      contextAround: 2,
      lineNumbers: true,
    }, {})

    const cmd = exec.mock.calls[0][0] as string
    expect(cmd).toContain("'-i'")
    expect(cmd).toContain("'-U'")
    expect(cmd).toContain("'--multiline-dotall'")
    expect(cmd).toContain("'-n'")
    expect(cmd).toContain("'-C' '2'")
    expect(cmd).toContain("'--glob' '*.ts'")
    expect(cmd).toContain("'src'")
  })

  it('rejects context params with non-content output mode', async () => {
    const backend = makeBackend({ exec: vi.fn() })
    const t = tool(backend, 'grep')
    await expect(
      t.handler({ pattern: 'x', contextBefore: 3 }, {}),
    ).rejects.toThrow(/context parameters/)
  })

  it('rejects contextAround combined with contextBefore/contextAfter', async () => {
    const backend = makeBackend({ exec: vi.fn() })
    const t = tool(backend, 'grep')
    await expect(
      t.handler({ pattern: 'x', outputMode: 'content', contextAround: 2, contextBefore: 1 }, {}),
    ).rejects.toThrow(/mutually exclusive/)
  })

  it('returns "No matches found" on empty rg output', async () => {
    const exec = vi.fn().mockResolvedValue('')
    const backend = makeBackend({ exec })
    const t = tool(backend, 'grep')
    const result = await t.handler({ pattern: 'nope' }, {})
    expect(result.content[0].text).toBe('No matches found')
  })

  it('applies headLimit by truncating output lines', async () => {
    const exec = vi.fn().mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n'),
    )
    const backend = makeBackend({ exec })
    const t = tool(backend, 'grep')
    const result = await t.handler({ pattern: 'x', headLimit: 5 }, {})
    const lines = result.content[0].text.split('\n')
    expect(lines.slice(0, 5)).toEqual(['line0', 'line1', 'line2', 'line3', 'line4'])
    expect(lines[5]).toMatch(/\[output truncated to first 5 lines; 15 more hidden\]/)
  })

  it('surfaces a clear install hint when rg is missing', async () => {
    const exec = vi.fn().mockRejectedValue(
      new Error('Command execution failed with exit code 127: rg: command not found'),
    )
    const backend = makeBackend({ exec })
    const t = tool(backend, 'grep')
    await expect(t.handler({ pattern: 'x' }, {})).rejects.toThrow(/ripgrep.*to be installed/i)
  })

  it('shell-escapes a pattern containing a single quote', async () => {
    const exec = vi.fn().mockResolvedValue('')
    const backend = makeBackend({ exec })
    const t = tool(backend, 'grep')
    await t.handler({ pattern: "it's" }, {})
    const cmd = exec.mock.calls[0][0] as string
    // single quote escaped as '\''
    expect(cmd).toContain("'it'\\''s'")
  })

  it('is NOT registered when the backend has no exec capability (memory backend)', async () => {
    const memoryBackend = {
      type: 'Memory',
      rootDir: '/mem',
      connected: true,
      read: vi.fn(),
      write: vi.fn(),
      readdir: vi.fn(),
      mkdir: vi.fn(),
      exists: vi.fn(),
      stat: vi.fn(),
      touch: vi.fn(),
      scope: vi.fn(),
      listActiveScopes: vi.fn().mockResolvedValue([]),
      getMCPClient: vi.fn(),
      destroy: vi.fn(),
      list: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
    } as any
    const server = new AgentBackendMCPServer(memoryBackend)
    const names = Object.keys(server.server.getTools())
    expect(names).not.toContain('grep')
  })
})
