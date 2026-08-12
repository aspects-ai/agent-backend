import type { FileBasedBackend } from '../../../src/types.js'
import { describe, expect, it, vi } from 'vitest'

// Force every render to report a breached budget. `diff` returns undefined when
// its in-loop deadline or edit-length cap trips; reproducing that for real would
// mean feeding the suite an input large enough to burn the full 15s budget.
vi.mock('diff', async (importOriginal) => {
  const actual = await importOriginal<typeof import('diff')>()
  return { ...actual, createTwoFilesPatch: () => undefined }
})

const { AgentBackendMCPServer } = await import('../../../src/server/AgentBackendMCPServer.js')

interface ToolEntry {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: (args: any, ctx: { sessionId?: string }) => Promise<{ content: Array<{ type: string, text: string }> }>
}

function makeBackend(content: string): FileBasedBackend {
  return {
    type: 'LocalFilesystem',
    rootDir: '/ws',
    connected: true,
    read: vi.fn().mockResolvedValue(content),
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
  } as unknown as FileBasedBackend
}

function editTool(backend: FileBasedBackend): ToolEntry {
  const server = new AgentBackendMCPServer(backend)
  return server.server.getTools().edit_file as unknown as ToolEntry
}

describe('edit_file — breached diff budget', () => {
  it('still writes the file and says so', async () => {
    const backend = makeBackend('a\nb\n')
    const result = await editTool(backend).handler(
      { path: 'a.txt', edits: [{ oldText: 'b', newText: 'c' }] },
      {},
    )

    // The edit is the durable half of the call — it must survive a render that
    // could not be completed, and the caller must be able to tell it landed.
    expect(backend.write).toHaveBeenCalledWith('a.txt', 'a\nc\n')
    expect(result.content[0].text).toContain('Applied 1 edit to a.txt')
    expect(result.content[0].text).toContain('--- a.txt')
    expect(result.content[0].text).toContain('[diff omitted:')
    expect(result.content[0].text).toContain('15s / 20,000 line edits')
  }, 5000)

  it('pluralises the edit count', async () => {
    const backend = makeBackend('a\nb\n')
    const result = await editTool(backend).handler(
      {
        path: 'a.txt',
        edits: [{ oldText: 'a', newText: 'x' }, { oldText: 'b', newText: 'y' }],
      },
      {},
    )
    expect(result.content[0].text).toContain('Applied 2 edits to a.txt')
  }, 5000)

  it('does not claim an edit was applied on a dry run', async () => {
    const backend = makeBackend('a\nb\n')
    const result = await editTool(backend).handler(
      { path: 'a.txt', edits: [{ oldText: 'b', newText: 'c' }], dryRun: true },
      {},
    )
    expect(backend.write).not.toHaveBeenCalled()
    expect(result.content[0].text.startsWith('[DRY RUN]')).toBe(true)
    expect(result.content[0].text).not.toContain('Applied')
    expect(result.content[0].text).toContain('[diff omitted:')
  }, 5000)
})
