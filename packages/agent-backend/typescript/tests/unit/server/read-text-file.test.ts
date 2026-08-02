import type { FileBasedBackend } from '../../../src/types.js'
import { describe, expect, it, vi } from 'vitest'
import { AgentBackendMCPServer } from '../../../src/server/AgentBackendMCPServer.js'
import {
  DEFAULT_LIMIT,
  LINE_TRUNCATION_THRESHOLD,
  MAX_LIMIT,
} from '../../../src/server/tools.js'

interface ToolEntry {
  name: string
  description: string
  inputSchema: unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any, ctx: { sessionId?: string }) => Promise<{ content: Array<{ type: string, text: string }> }>
}

function makeBackend(
  fileContent: string | Error,
  fileSizeBytes?: number,
): FileBasedBackend {
  const read = vi.fn().mockImplementation(async () => {
    if (fileContent instanceof Error) throw fileContent
    return fileContent
  })
  const stat = vi.fn().mockResolvedValue({
    isFile: () => true,
    isDirectory: () => false,
    size: fileSizeBytes ?? (typeof fileContent === 'string' ? Buffer.byteLength(fileContent, 'utf8') : 0),
    mtime: new Date(),
    atime: new Date(),
    birthtime: new Date(),
    mode: 0o644,
  })
  return {
    type: 'LocalFilesystem',
    rootDir: '/test',
    connected: true,
    read,
    write: vi.fn(),
    readdir: vi.fn(),
    mkdir: vi.fn(),
    exists: vi.fn(),
    stat,
    exec: vi.fn(),
    touch: vi.fn(),
    scope: vi.fn(),
    listActiveScopes: vi.fn().mockResolvedValue([]),
    getMCPClient: vi.fn(),
    destroy: vi.fn(),
  } as unknown as FileBasedBackend
}

function getReadTool(backend: FileBasedBackend): ToolEntry {
  const server = new AgentBackendMCPServer(backend)
  return server.server.getTools()['read_text_file'] as unknown as ToolEntry
}

async function call(
  tool: ToolEntry,
  args: Record<string, unknown>,
): Promise<string> {
  const result = await tool.handler(args, {})
  return result.content[0].text
}

describe('read_text_file — paging and truncation', () => {
  describe('small files (no footer)', () => {
    it('returns the full body with no footer when file fits under DEFAULT_LIMIT', async () => {
      const lines = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`)
      const content = lines.join('\n')
      const tool = getReadTool(makeBackend(content))

      const text = await call(tool, { path: 'app.json' })
      expect(text).toBe(content)
      expect(text).not.toMatch(/\[showing/)
    })

    it('returns an empty body with no footer for an empty file', async () => {
      const tool = getReadTool(makeBackend(''))
      const text = await call(tool, { path: 'empty.txt' })
      expect(text).toBe('')
    })
  })

  describe('implicit paging', () => {
    it('clips large files to DEFAULT_LIMIT and appends the implicit footer with size', async () => {
      const totalLines = 4512
      const lines = Array.from({ length: totalLines }, (_, i) => `line ${i + 1}`)
      const content = lines.join('\n')
      // Force a ~1.4 MB size independent of the synthetic content length.
      const tool = getReadTool(makeBackend(content, 1_468_006))

      const text = await call(tool, { path: 'worker.log' })
      const lastNewline = text.lastIndexOf('\n')
      const footer = text.slice(lastNewline + 1)
      const body = text.slice(0, lastNewline)

      expect(body.split('\n')).toHaveLength(DEFAULT_LIMIT)
      expect(body.split('\n')[0]).toBe('line 1')
      expect(body.split('\n')[DEFAULT_LIMIT - 1]).toBe(`line ${DEFAULT_LIMIT}`)
      expect(footer).toBe(
        '[showing lines 1-1,000 of 4,512; file is ~1.4 MB. Call again with offset and limit to read more.]',
      )
    })
  })

  describe('explicit paging (offset / limit)', () => {
    it('slices by offset + limit and uses the short explicit footer', async () => {
      const totalLines = 120000
      const content = Array.from({ length: totalLines }, (_, i) => `line ${i + 1}`).join('\n')
      const tool = getReadTool(makeBackend(content))

      const text = await call(tool, { path: 'worker.log', offset: 50000, limit: 200 })
      const [body, footer] = text.split(/\n(?=\[showing)/)

      const bodyLines = body.split('\n')
      expect(bodyLines).toHaveLength(200)
      expect(bodyLines[0]).toBe('line 50000')
      expect(bodyLines[199]).toBe('line 50199')
      expect(footer).toBe('[showing lines 50,000-50,199 of 120,000.]')
    })

    it('omits the footer when offset=1 and the slice covers the whole file', async () => {
      const content = Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n')
      const tool = getReadTool(makeBackend(content))
      const text = await call(tool, { path: 'small.txt', offset: 1, limit: 50 })
      expect(text).toBe(content)
    })

    it('still appends a footer when offset>1 even if the slice reaches the end', async () => {
      const content = Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n')
      const tool = getReadTool(makeBackend(content))
      const text = await call(tool, { path: 'small.txt', offset: 5, limit: 100 })
      expect(text).toMatch(/\[showing lines 5-10 of 10\.\]$/)
    })

    it('returns an empty body and a past-end footer for out-of-range offset', async () => {
      const content = Array.from({ length: 100 }, (_, i) => `l${i}`).join('\n')
      const tool = getReadTool(makeBackend(content))
      const text = await call(tool, { path: 'short.txt', offset: 50000 })
      expect(text).toBe('[offset 50,000 is beyond end of file (100 lines).]')
    })

    it('clamps limit above MAX_LIMIT silently', async () => {
      const total = MAX_LIMIT + 500
      const content = Array.from({ length: total }, (_, i) => `l${i}`).join('\n')
      const tool = getReadTool(makeBackend(content))
      const text = await call(tool, { path: 'x.txt', offset: 1, limit: MAX_LIMIT + 10_000 })
      const body = text.split(/\n(?=\[showing)/)[0]
      expect(body.split('\n')).toHaveLength(MAX_LIMIT)
      expect(text).toMatch(new RegExp(`\\[showing lines 1-${MAX_LIMIT.toLocaleString('en-US')} of ${total.toLocaleString('en-US')}\\.\\]$`))
    })
  })

  describe('single paging mode', () => {
    it('exposes only path/offset/limit — no head or tail parameter', async () => {
      const tool = getReadTool(makeBackend('a\nb'))
      const schema = tool.inputSchema as Record<string, unknown>
      expect(Object.keys(schema)).toEqual(expect.arrayContaining(['path', 'offset', 'limit']))
      expect(Object.keys(schema)).not.toContain('head')
      expect(Object.keys(schema)).not.toContain('tail')
    })

    it('does not advertise MAX_LIMIT in model-visible text', async () => {
      const tool = getReadTool(makeBackend('a\nb'))
      expect(tool.description).not.toContain(String(MAX_LIMIT))
    })

    it('serves a first-N-lines read via offset 1 + limit', async () => {
      const content = Array.from({ length: 4512 }, (_, i) => `l${i}`).join('\n')
      const tool = getReadTool(makeBackend(content))
      const text = await call(tool, { path: 'big.log', offset: 1, limit: 100 })
      const body = text.split(/\n(?=\[showing)/)[0]
      expect(body.split('\n')).toHaveLength(100)
      expect(text).toMatch(/\[showing lines 1-100 of 4,512\.\]$/)
    })

    it('omits the footer when an explicit page covers the whole file', async () => {
      const content = Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n')
      const tool = getReadTool(makeBackend(content))
      const text = await call(tool, { path: 'x', offset: 1, limit: 100 })
      expect(text).toBe(content)
    })
  })

  describe('line truncation', () => {
    it('clips a single long line inline with a marker showing original length', async () => {
      const longLine = 'x'.repeat(1_100_000)
      const tool = getReadTool(makeBackend(longLine, 1_153_433))

      const text = await call(tool, { path: 'bundle.min.js' })
      // inline marker
      expect(text).toContain(`… [line truncated, original ${longLine.length} chars]`)
      const [body, footer] = text.split(/\n(?=\[showing)/)
      // body is just the clipped single line + marker
      expect(body.startsWith('x'.repeat(LINE_TRUNCATION_THRESHOLD))).toBe(true)
      // implicit-mode footer appears even though sliceEnd == totalLines
      expect(footer).toBe(
        '[showing lines 1-1 of 1; file is ~1.1 MB. Call again with offset and limit to read more.]',
      )
    })

    it('does NOT emit an implicit footer for a small file with no long lines', async () => {
      const content = 'short content'
      const tool = getReadTool(makeBackend(content))
      const text = await call(tool, { path: 'x.txt' })
      expect(text).toBe(content)
    })

    it('leaves lines at exactly LINE_TRUNCATION_THRESHOLD untouched', async () => {
      const exact = 'a'.repeat(LINE_TRUNCATION_THRESHOLD)
      const tool = getReadTool(makeBackend(exact))
      const text = await call(tool, { path: 'x.txt' })
      expect(text).toBe(exact)
    })
  })

  describe('no mode-conflict rejection', () => {
    it('serves a read that also carries the removed head/tail keys instead of throwing', async () => {
      const content = Array.from({ length: 200 }, (_, i) => `l${i}`).join('\n')
      const tool = getReadTool(makeBackend(content))
      // The exact shape models were sending against the old four-parameter schema.
      const text = await call(tool, {
        path: 'x',
        offset: 1,
        limit: MAX_LIMIT,
        head: MAX_LIMIT,
        tail: MAX_LIMIT,
      })
      expect(text).toBe(content)
    })
  })

  describe('error passthrough', () => {
    it('surfaces backend read errors unchanged (e.g. file not found)', async () => {
      const tool = getReadTool(makeBackend(new Error('ENOENT: no such file')))
      await expect(call(tool, { path: 'nope.txt' })).rejects.toThrow('ENOENT: no such file')
    })
  })

  describe('size suffix formatting', () => {
    // Run read_text_file in implicit mode with various stat sizes and read the suffix.
    async function sizeSuffix(bytes: number): Promise<string> {
      const content = Array.from({ length: DEFAULT_LIMIT + 1 }, () => 'x').join('\n')
      const tool = getReadTool(makeBackend(content, bytes))
      const text = await call(tool, { path: 'x' })
      const m = text.match(/file is ~([^.]+(?:\.\d+)?\s*[KMG]?B|<1 KB)/)
      if (!m) throw new Error(`no size suffix found in: ${text}`)
      return m[1]
    }

    it('<1 KB for sub-kilobyte sizes', async () => {
      expect(await sizeSuffix(500)).toBe('<1 KB')
    })

    it('integer KB for sub-megabyte sizes', async () => {
      expect(await sizeSuffix(4 * 1024)).toBe('4 KB')
    })

    it('one-decimal MB for sub-gigabyte sizes', async () => {
      expect(await sizeSuffix(Math.round(1.4 * 1024 * 1024))).toBe('1.4 MB')
    })

    it('one-decimal GB for gigabyte-and-up sizes', async () => {
      expect(await sizeSuffix(Math.round(2.5 * 1024 * 1024 * 1024))).toBe('2.5 GB')
    })
  })
})
