import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { Backend, FileBasedBackend } from '../types.js'
import { minimatch } from 'minimatch'
import * as path from 'path'
import { z } from 'zod'

type BackendGetter = (sessionId?: string) => Promise<Backend> | Backend

/**
 * Default patterns to exclude from directory listings (gitignore-style).
 * These match at any depth in the tree.
 */
/**
 * read_text_file paging defaults. Tunable here; callers see them via the tool's
 * footer. See opensdd/daemon.md for the behavioral contract.
 */
export const DEFAULT_LIMIT = 1000
export const MAX_LIMIT = 5000
export const LINE_TRUNCATION_THRESHOLD = 2000

export const DEFAULT_EXCLUDE_PATTERNS = [
  // Version control
  '.git',
  '.svn',
  '.hg',
  // Dependencies
  'node_modules',
  '.venv',
  'venv',
  '__pycache__',
  '.tox',
  '.nox',
  // Build artifacts
  'dist',
  'build',
  '.next',
  '.nuxt',
  '.output',
  'target',
  // Caches
  '.cache',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  // Coverage
  'coverage',
  '.coverage',
  'htmlcov',
  // IDE
  '.idea',
  '.vscode',
  // Misc
  '.DS_Store',
  '*.egg-info',
  '.eggs',
]

/**
 * Create a simple unified diff between two strings
 * This is a lightweight implementation - the official server uses the 'diff' library
 */
function createUnifiedDiff(original: string, modified: string, filepath: string): string {
  const originalLines = original.split('\n')
  const modifiedLines = modified.split('\n')

  const lines: string[] = [
    `--- ${filepath}`,
    `+++ ${filepath}`,
  ]

  // Simple diff: show context around changes
  let i = 0
  let j = 0

  while (i < originalLines.length || j < modifiedLines.length) {
    // Skip matching lines
    while (i < originalLines.length && j < modifiedLines.length && originalLines[i] === modifiedLines[j]) {
      i++
      j++
    }

    // If we're at the end, break
    if (i >= originalLines.length && j >= modifiedLines.length) break

    // Find extent of difference
    const diffStartI = i
    const diffStartJ = j

    // Count removed lines (in original but changed)
    let removedCount = 0
    while (i < originalLines.length && (j >= modifiedLines.length || originalLines[i] !== modifiedLines[j])) {
      // Check if this line appears later in modified
      let found = false
      for (let k = j; k < Math.min(j + 10, modifiedLines.length); k++) {
        if (originalLines[i] === modifiedLines[k]) {
          found = true
          break
        }
      }
      if (found) break
      i++
      removedCount++
    }

    // Count added lines (in modified but not original)
    let addedCount = 0
    const tempJ = j
    while (j < modifiedLines.length && (diffStartI + removedCount >= originalLines.length || modifiedLines[j] !== originalLines[diffStartI + removedCount])) {
      let found = false
      for (let k = diffStartI + removedCount; k < Math.min(diffStartI + removedCount + 10, originalLines.length); k++) {
        if (modifiedLines[j] === originalLines[k]) {
          found = true
          break
        }
      }
      if (found) break
      j++
      addedCount++
    }

    if (removedCount > 0 || addedCount > 0) {
      // Add hunk header
      const origStart = diffStartI + 1
      const modStart = diffStartJ + 1
      lines.push(`@@ -${origStart},${removedCount} +${modStart},${addedCount} @@`)

      // Add removed lines
      for (let k = 0; k < removedCount; k++) {
        lines.push(`-${originalLines[diffStartI + k]}`)
      }

      // Add added lines
      for (let k = 0; k < addedCount; k++) {
        lines.push(`+${modifiedLines[tempJ + k]}`)
      }
    }
  }

  return lines.join('\n')
}

/**
 * Format file size in human-readable format (matches official MCP filesystem server)
 */
function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  if (bytes === 0) return '0 B'

  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  if (i < 0 || i === 0) return `${bytes} ${units[0]}`

  const unitIndex = Math.min(i, units.length - 1)
  return `${(bytes / Math.pow(1024, unitIndex)).toFixed(2)} ${units[unitIndex]}`
}

/**
 * Format a byte count for the read_text_file footer. Granularities mandated by spec:
 * `<1 KB`, integer KB, one-decimal MB, one-decimal GB.
 */
function formatTextFileSize(bytes: number): string {
  if (bytes < 1024) return '<1 KB'
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

/**
 * Render an integer with en-US comma thousands-separators (e.g. 4512 → "4,512").
 */
function formatCount(n: number): string {
  return n.toLocaleString('en-US')
}

/**
 * Clip a single line at LINE_TRUNCATION_THRESHOLD. Announced inline so the model
 * can tell the content is partial and route to a different tool (e.g. grep).
 */
function truncateLine(line: string): string {
  if (line.length <= LINE_TRUNCATION_THRESHOLD) return line
  return `${line.slice(0, LINE_TRUNCATION_THRESHOLD)}… [line truncated, original ${line.length} chars]`
}

/**
 * Get MIME type for a file path (simple implementation to avoid extra dependency)
 */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    // Images
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.bmp': 'image/bmp',
    // Audio
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.m4a': 'audio/mp4',
    '.flac': 'audio/flac',
    // Video
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    // Documents
    '.pdf': 'application/pdf',
    '.json': 'application/json',
    '.xml': 'application/xml',
    // Archives
    '.zip': 'application/zip',
    '.gz': 'application/gzip',
    '.tar': 'application/x-tar',
  }
  return mimeTypes[ext] || 'application/octet-stream'
}

/**
 * Register all filesystem tools on an MCP server.
 * Compatible with official @modelcontextprotocol/server-filesystem.
 * Does NOT include exec tool - use registerExecTool() separately for backends that support it.
 */
export function registerFilesystemTools(server: McpServer, getBackend: BackendGetter): void {

  // ─────────────────────────────────────────────────────────────────
  // READ OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  server.registerTool(
    'read_text_file',
    {
      description: `Read file contents as text. Paginates by default: with no paging parameters, returns the first ${DEFAULT_LIMIT} lines and appends a footer indicating how much of the file was shown. Use offset and limit for explicit paging, or head/tail for first/last-N-line reads (the three modes are mutually exclusive). Lines longer than ${LINE_TRUNCATION_THRESHOLD} chars are truncated with an inline marker.`,
      inputSchema: {
        path: z.string().describe('Path to the file'),
        offset: z.number().int().positive().optional()
          .describe('1-based line number to start at. Defaults to 1.'),
        limit: z.number().int().positive().optional()
          .describe(`Max lines to return. Defaults to ${DEFAULT_LIMIT}. Values over ${MAX_LIMIT} are clamped.`),
        head: z.number().int().positive().optional()
          .describe('Return only the first N lines. Mutually exclusive with offset/limit and tail.'),
        tail: z.number().int().positive().optional()
          .describe('Return only the last N lines. Mutually exclusive with offset/limit and head.'),
      },
    },
    async ({ path: filePath, offset, limit, head, tail }, { sessionId }) => {
      // Exactly one of { head, tail, offset/limit } may be active. We already know
      // head and tail are mutually exclusive today; the same applies to offset/limit
      // versus head/tail now that paging is a first-class mode.
      const pageMode = offset != null || limit != null
      const activeModes = (head != null ? 1 : 0) + (tail != null ? 1 : 0) + (pageMode ? 1 : 0)
      if (activeModes > 1) {
        if (head != null && tail != null) {
          throw new Error('cannot specify both `head` and `tail` — pick one paging mode')
        }
        if (head != null) {
          throw new Error('cannot specify both `head` and `offset`/`limit` — pick one paging mode')
        }
        throw new Error('cannot specify both `tail` and `offset`/`limit` — pick one paging mode')
      }

      const backend = await getBackend(sessionId) as FileBasedBackend
      const content = await backend.read(filePath, { encoding: 'utf8' }) as string
      const allLines = content.split('\n')
      const totalLines = allLines.length

      let slice: string[]
      let mode: 'head' | 'tail' | 'page'
      let pageStart = 1 // 1-based line of the first line in the slice (page mode)
      const implicit = !pageMode && head == null && tail == null

      if (head != null) {
        mode = 'head'
        slice = allLines.slice(0, head)
      } else if (tail != null) {
        mode = 'tail'
        slice = allLines.slice(Math.max(0, totalLines - tail))
      } else {
        mode = 'page'
        const rawLimit = limit ?? DEFAULT_LIMIT
        const effectiveLimit = Math.min(rawLimit, MAX_LIMIT)
        pageStart = offset ?? 1
        const startIdx = pageStart - 1
        slice = startIdx >= totalLines
          ? []
          : allLines.slice(startIdx, startIdx + effectiveLimit)
      }

      const hadLineTruncation = slice.some(l => l.length > LINE_TRUNCATION_THRESHOLD)
      const truncated = slice.map(truncateLine)
      const body = truncated.join('\n')

      // Footer decision. For head/tail, footer appears whenever the slice doesn't
      // cover the whole file. For page mode, same — plus for implicit paging we
      // also emit the footer if any line was truncated, so a pathological
      // single-line file still surfaces file size and the "call again" hint.
      let footer = ''
      if (mode === 'head') {
        if (slice.length < totalLines) {
          footer = `[showing first ${formatCount(slice.length)} lines of ${formatCount(totalLines)}.]`
        }
      } else if (mode === 'tail') {
        if (slice.length < totalLines) {
          footer = `[showing last ${formatCount(slice.length)} lines of ${formatCount(totalLines)}.]`
        }
      } else {
        const sliceEndLine = pageStart + slice.length - 1 // inclusive
        const coversWholeFile = pageStart === 1 && slice.length >= totalLines
        const needFooter = !coversWholeFile || (implicit && hadLineTruncation)
        if (needFooter) {
          if (slice.length === 0) {
            footer = `[offset ${formatCount(pageStart)} is beyond end of file (${formatCount(totalLines)} lines).]`
          } else if (implicit) {
            const stats = await backend.stat(filePath)
            const size = formatTextFileSize(stats.size)
            footer = `[showing lines ${formatCount(pageStart)}-${formatCount(sliceEndLine)} of ${formatCount(totalLines)}; file is ~${size}. Call again with offset and limit to read more.]`
          } else {
            footer = `[showing lines ${formatCount(pageStart)}-${formatCount(sliceEndLine)} of ${formatCount(totalLines)}.]`
          }
        }
      }

      let text = body
      if (footer) {
        if (text.length > 0 && !text.endsWith('\n')) text += '\n'
        text += footer
      }

      return { content: [{ type: 'text', text }] }
    }
  )

  server.registerTool(
    'read_media_file',
    {
      description: 'Read an image or audio file, returns base64 data with MIME type',
      inputSchema: {
        path: z.string().describe('Path to the media file'),
        force: z.boolean().optional().describe('Bypass the image/audio MIME type check and return the file as a base64 blob regardless of type. Off by default.'),
      },
    },
    async ({ path: filePath, force }, { sessionId }) => {
      const backend = await getBackend(sessionId) as FileBasedBackend
      const mimeType = getMimeType(filePath)
      const isMedia = mimeType.startsWith('image/') || mimeType.startsWith('audio/')

      // Per the Anthropic filesystem MCP spec, this tool is scoped to image/* and audio/*.
      // For anything else we return a text message with file-level info so the model can route
      // to a more appropriate tool. `force: true` is an explicit opt-in bypass for callers that
      // genuinely need the raw bytes.
      if (!isMedia && !force) {
        const stats = await backend.stat(filePath)
        const ext = path.extname(filePath) || '(none)'
        const info = [
          `Path: ${filePath}`,
          `Extension: ${ext}`,
          `Detected MIME type: ${mimeType}`,
          `Size: ${stats.size} bytes`,
          `Modified: ${stats.mtime.toISOString()}`,
        ].join('\n')
        return {
          content: [{
            type: 'text',
            text: `Unrecognized file type ${ext} for read_media_file (only image/* and audio/* are supported).\n\n${info}\n\nTry read_text_file for text content or get_file_info for full metadata. If you really need raw bytes, call read_media_file again with force: true.`,
          }],
          isError: true,
        }
      }

      const buffer = await backend.read(filePath, { encoding: 'buffer' }) as Buffer
      const base64 = buffer.toString('base64')
      const contentType = mimeType.startsWith('image/')
        ? 'image'
        : mimeType.startsWith('audio/')
          ? 'audio'
          : 'blob'

      return {
        content: [{
          type: contentType as 'image' | 'audio',
          data: base64,
          mimeType,
        }]
      }
    }
  )

  server.registerTool(
    'read_multiple_files',
    {
      description: 'Read several files simultaneously. Failed reads for individual files won\'t stop the entire operation.',
      inputSchema: {
        paths: z.array(z.string()).min(1).describe('Array of file paths to read'),
      },
    },
    async ({ paths }, { sessionId }) => {
      const backend = await getBackend(sessionId) as FileBasedBackend
      const results = await Promise.all(
        paths.map(async (filePath: string) => {
          try {
            const content = await backend.read(filePath, { encoding: 'utf8' })
            return `${filePath}:\n${content}\n`
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            return `${filePath}: Error - ${errorMessage}`
          }
        })
      )

      // Join with separator matching official MCP filesystem server format
      return {
        content: [{ type: 'text', text: results.join('\n---\n') }]
      }
    }
  )

  // ─────────────────────────────────────────────────────────────────
  // WRITE OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  server.registerTool(
    'write_file',
    {
      description: 'Create new file or completely overwrite existing file with new content. Parent directories are created automatically if they don\'t exist.',
      inputSchema: {
        path: z.string().describe('Path to the file'),
        content: z.string().describe('Content to write'),
      },
    },
    async ({ path: filePath, content }, { sessionId }) => {
      const backend = await getBackend(sessionId) as FileBasedBackend

      // Ensure parent directory exists (convenience feature - official server doesn't do this)
      const dir = path.dirname(filePath)
      if (dir && dir !== '.') {
        await backend.mkdir(dir, { recursive: true })
      }

      // Note: The official MCP filesystem server uses atomic writes (temp file + rename)
      // to prevent race conditions. AgentBackend's writeFile uses standard fs.writeFile.
      // If atomic writes become necessary, this should be updated to use a temp file pattern.
      // See: https://github.com/modelcontextprotocol/servers/blob/main/src/filesystem/lib.ts
      await backend.write(filePath, content)
      return {
        content: [{ type: 'text', text: `Successfully wrote to ${filePath}` }]
      }
    }
  )

  server.registerTool(
    'edit_file',
    {
      description: 'Make selective edits using exact text matching. Each edit\'s oldText must be unique in the current file state, unless replaceAll is set for that edit. Edits apply sequentially — later edits see the result of earlier ones. Returns a unified diff of the changes.',
      inputSchema: {
        path: z.string().describe('Path to the file'),
        edits: z.array(z.object({
          oldText: z.string().describe('Text to search for — must match exactly and (unless replaceAll is true) must be unique in the current file state. Add surrounding context to disambiguate if needed.'),
          newText: z.string().describe('Text to replace with'),
          replaceAll: z.boolean().optional().describe('Replace every occurrence of oldText. Use for renames or other bulk replacements; defaults to false.'),
        })).describe('Array of edits to apply sequentially'),
        dryRun: z.boolean().optional()
          .describe('Preview changes using git-style diff format (defaults to false)'),
      },
    },
    async ({ path: filePath, edits, dryRun: dryRunParam }, { sessionId }) => {
      const dryRun = dryRunParam ?? false
      const backend = await getBackend(sessionId) as FileBasedBackend
      const original = await backend.read(filePath, { encoding: 'utf8' }) as string

      const normalizeLineEndings = (text: string) => text.replace(/\r\n/g, '\n')
      const countOccurrences = (haystack: string, needle: string): number => {
        if (needle.length === 0) return 0
        return haystack.split(needle).length - 1
      }

      let modified = normalizeLineEndings(original)

      for (let i = 0; i < edits.length; i++) {
        const edit = edits[i]
        const normalizedOld = normalizeLineEndings(edit.oldText)
        const normalizedNew = normalizeLineEndings(edit.newText)
        const replaceAll = edit.replaceAll ?? false

        const occurrences = countOccurrences(modified, normalizedOld)
        if (occurrences === 0) {
          throw new Error(`edit ${i + 1}: could not find exact match for oldText. Check whitespace and line endings, or verify the file state after any preceding edits.`)
        }
        if (occurrences > 1 && !replaceAll) {
          throw new Error(`edit ${i + 1}: oldText appears ${occurrences} times in the file; pass replaceAll: true to replace every occurrence, or add surrounding context to oldText to make it unique.`)
        }

        modified = replaceAll
          ? modified.replaceAll(normalizedOld, normalizedNew)
          : modified.replace(normalizedOld, normalizedNew)
      }

      // Generate unified diff
      const diff = createUnifiedDiff(normalizeLineEndings(original), modified, filePath)

      if (!dryRun && modified !== normalizeLineEndings(original)) {
        await backend.write(filePath, modified)
      }

      return {
        content: [{
          type: 'text',
          text: dryRun ? `[DRY RUN]\n${diff}` : diff
        }]
      }
    }
  )

  // ─────────────────────────────────────────────────────────────────
  // DIRECTORY OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  server.registerTool(
    'create_directory',
    {
      description: 'Create new directory or ensure it exists. Creates parent directories automatically.',
      inputSchema: {
        path: z.string().describe('Path to the directory'),
      },
    },
    async ({ path: dirPath }, { sessionId }) => {
      const backend = await getBackend(sessionId) as FileBasedBackend
      await backend.mkdir(dirPath, { recursive: true })
      return {
        content: [{ type: 'text', text: `Created directory: ${dirPath}` }]
      }
    }
  )

  server.registerTool(
    'list_directory',
    {
      description: 'List directory contents with [FILE] or [DIR] prefixes. Use "." for the root/current directory.',
      inputSchema: {
        path: z.string().describe('Path to the directory (use "." for root)'),
      },
    },
    async ({ path: dirPath }, { sessionId }) => {
      const backend = await getBackend(sessionId) as FileBasedBackend
      const entries = await backend.readdir(dirPath) as string[]

      const formatted = await Promise.all(
        entries.map(async (entry) => {
          try {
            const stats = await backend.stat(path.join(dirPath, entry))
            const prefix = stats.isDirectory() ? '[DIR]' : '[FILE]'
            return `${prefix} ${entry}`
          } catch {
            return `[?] ${entry}`
          }
        })
      )

      return {
        content: [{ type: 'text', text: formatted.join('\n') }]
      }
    }
  )

  server.registerTool(
    'list_directory_with_sizes',
    {
      description: 'List directory contents with prefixes, file sizes, and summary statistics. Use "." for the root/current directory.',
      inputSchema: {
        path: z.string().describe('Path to the directory (use "." for root)'),
        sortBy: z.enum(['name', 'size']).optional()
          .describe('Sort entries by name or size (descending), defaults to name'),
      },
    },
    async ({ path: dirPath, sortBy: sortByParam }, { sessionId }) => {
      const sortBy = sortByParam ?? 'name'
      const backend = await getBackend(sessionId) as FileBasedBackend
      const entries = await backend.readdir(dirPath) as string[]

      const detailed = await Promise.all(
        entries.map(async (entry) => {
          try {
            const stats = await backend.stat(path.join(dirPath, entry))
            return {
              name: entry,
              isDir: stats.isDirectory(),
              size: stats.size,
            }
          } catch {
            return { name: entry, isDir: false, size: 0 }
          }
        })
      )

      // Sort (size is descending, name is ascending)
      detailed.sort((a, b) => {
        if (sortBy === 'size') return b.size - a.size
        return a.name.localeCompare(b.name)
      })

      const formatted = detailed.map((d) => {
        const prefix = d.isDir ? '[DIR]' : '[FILE]'
        const size = d.isDir ? '' : ` ${formatSize(d.size)}`
        return `${prefix} ${d.name.padEnd(30)}${size}`
      })

      const totalSize = detailed.filter(d => !d.isDir).reduce((sum, d) => sum + d.size, 0)
      const fileCount = detailed.filter(d => !d.isDir).length
      const dirCount = detailed.filter(d => d.isDir).length

      formatted.push('')
      formatted.push(`Total: ${fileCount} files, ${dirCount} directories`)
      formatted.push(`Combined size: ${formatSize(totalSize)}`)

      return {
        content: [{ type: 'text', text: formatted.join('\n') }]
      }
    }
  )

  server.registerTool(
    'directory_tree',
    {
      description: 'Get recursive JSON tree structure of directory contents. Each entry includes name, type (file/directory), and children for directories. By default excludes common non-essential directories (node_modules, .venv, .git, etc.).',
      inputSchema: {
        path: z.string().describe('Path to the directory'),
        excludePatterns: z.array(z.string()).optional()
          .describe('Additional glob patterns to exclude (e.g., "*.log", "temp")'),
        includeDefaultExcludes: z.boolean().optional().default(true)
          .describe('Include default exclusions (node_modules, .venv, .git, etc.). Set to false to disable.'),
      },
    },
    async ({ path: dirPath, excludePatterns: excludePatternsParam, includeDefaultExcludes }, { sessionId }) => {
      // Combine default excludes with user-provided patterns
      const defaultExcludes = includeDefaultExcludes !== false ? DEFAULT_EXCLUDE_PATTERNS : []
      const excludePatterns = [...defaultExcludes, ...(excludePatternsParam ?? [])]
      const backend = await getBackend(sessionId) as FileBasedBackend

      interface TreeNode {
        name: string
        type: 'directory' | 'file'
        size?: number
        children?: TreeNode[]
      }

      async function buildTree(currentPath: string): Promise<TreeNode[]> {
        const entries = await backend.readdir(currentPath) as string[]
        const children: TreeNode[] = []

        for (const entry of entries) {
          const entryPath = path.join(currentPath, entry)
          const relativePath = path.relative(dirPath, entryPath)

          // Use minimatch for proper glob pattern matching (matches official server behavior)
          const shouldExclude = excludePatterns.some((pattern: string) => {
            // Support both exact matches and glob patterns
            if (pattern.includes('*')) {
              return minimatch(relativePath, pattern, { dot: true })
            }
            // For non-glob patterns, match as directory/file name or path component
            return minimatch(relativePath, pattern, { dot: true }) ||
              minimatch(relativePath, `**/${pattern}`, { dot: true }) ||
              minimatch(relativePath, `**/${pattern}/**`, { dot: true })
          })

          if (shouldExclude) continue

          try {
            const stats = await backend.stat(entryPath)
            if (stats.isDirectory()) {
              children.push({
                name: entry,
                type: 'directory',
                children: await buildTree(entryPath),
              })
            } else {
              children.push({
                name: entry,
                type: 'file',
                size: stats.size,
              })
            }
          } catch {
            // Skip inaccessible entries
          }
        }

        return children
      }

      const tree = await buildTree(dirPath)
      return {
        content: [{ type: 'text', text: JSON.stringify(tree, null, 2) }]
      }
    }
  )

  // ─────────────────────────────────────────────────────────────────
  // FILE OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  server.registerTool(
    'move_file',
    {
      description: 'Move or rename files and directories. Fails if destination exists. Both source and destination must be within the workspace.',
      inputSchema: {
        source: z.string().describe('Source path'),
        destination: z.string().describe('Destination path'),
      },
    },
    async ({ source, destination }, { sessionId }) => {
      const backend = await getBackend(sessionId) as FileBasedBackend

      // Verify source exists
      if (!await backend.exists(source)) {
        throw new Error(`Source does not exist: ${source}`)
      }

      // Check if destination exists - fail if it does
      if (await backend.exists(destination)) {
        throw new Error(`Destination already exists: ${destination}`)
      }

      // Ensure destination parent directory exists
      const destDir = path.dirname(destination)
      if (destDir && destDir !== '.') {
        await backend.mkdir(destDir, { recursive: true })
      }

      // Use rename API (matches Node fs.promises)
      // The backend.exists() calls above already validate the paths are within bounds
      await backend.rename(source, destination)
      return {
        content: [{ type: 'text', text: `Moved ${source} to ${destination}` }]
      }
    }
  )

  server.registerTool(
    'search_files',
    {
      description: 'Recursively search for files and directories matching a glob pattern. Patterns match against paths relative to the search directory. Pass sortBy: "mtime" to sort results by modification time (newest first) — useful for surfacing recently-edited files.',
      inputSchema: {
        path: z.string().describe('Starting directory path'),
        pattern: z.string().describe('Glob pattern to match (e.g., "*.ts", "**/*.js", "src/**/*.tsx")'),
        excludePatterns: z.array(z.string()).optional()
          .describe('Patterns to exclude from results'),
        sortBy: z.enum(['path', 'mtime']).optional()
          .describe('Sort order for results. "path" (default) sorts alphabetically by path. "mtime" sorts by modification time, newest first.'),
      },
    },
    async ({ path: searchPath, pattern, excludePatterns: excludePatternsParam, sortBy: sortByParam }, { sessionId }) => {
      const excludePatterns = excludePatternsParam ?? []
      const sortBy = sortByParam ?? 'path'
      const backend = await getBackend(sessionId) as FileBasedBackend
      const results: Array<{ path: string, mtimeMs: number }> = []

      async function searchDir(currentPath: string): Promise<void> {
        const entries = await backend.readdir(currentPath) as string[]

        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry)
          const relativePath = path.relative(searchPath, fullPath)

          const shouldExclude = excludePatterns.some((excludePattern: string) =>
            minimatch(relativePath, excludePattern, { dot: true })
          )
          if (shouldExclude) continue

          let stats
          try {
            stats = await backend.stat(fullPath)
          } catch {
            continue
          }

          if (minimatch(relativePath, pattern, { dot: true })) {
            results.push({ path: fullPath, mtimeMs: stats.mtime.getTime() })
          }

          if (stats.isDirectory()) {
            await searchDir(fullPath)
          }
        }
      }

      await searchDir(searchPath)

      if (sortBy === 'mtime') {
        results.sort((a, b) => b.mtimeMs - a.mtimeMs)
      } else {
        results.sort((a, b) => a.path.localeCompare(b.path))
      }

      const paths = results.map(r => r.path)
      return {
        content: [{ type: 'text', text: paths.length > 0 ? paths.join('\n') : 'No matches found' }]
      }
    }
  )

  server.registerTool(
    'get_file_info',
    {
      description: 'Get detailed metadata: size, timestamps, type, permissions',
      inputSchema: {
        path: z.string().describe('Path to the file or directory'),
      },
    },
    async ({ path: filePath }, { sessionId }) => {
      const backend = await getBackend(sessionId) as FileBasedBackend
      const stats = await backend.stat(filePath)

      const info = {
        path: filePath,
        type: stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other',
        size: stats.size,
        created: stats.birthtime?.toISOString(),
        modified: stats.mtime.toISOString(),
        accessed: stats.atime.toISOString(),
        mode: stats.mode.toString(8),
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(info, null, 2) }]
      }
    }
  )

  server.registerTool(
    'list_allowed_directories',
    {
      description: 'List all directories the server is allowed to access',
      inputSchema: z.object({}),
    },
    async (_args, { sessionId }) => {
      const backend = await getBackend(sessionId) as FileBasedBackend
      return {
        content: [{
          type: 'text',
          text: `Allowed directories:\n- ${backend.rootDir}`
        }]
      }
    }
  )
}

/**
 * Register exec tool on an MCP server.
 * Should only be called for backends that support command execution (FileBasedBackend).
 * Do NOT call this for MemoryBackend.
 */
export function registerExecTool(server: McpServer, getBackend: BackendGetter): void {
  server.registerTool(
    'exec',
    {
      description: 'Execute a shell command in the workspace directory. Not available for memory backends.',
      inputSchema: {
        command: z.string().describe('Shell command to execute'),
        env: z.record(z.string(), z.string()).optional()
          .describe('Optional environment variables to set for this command'),
      },
    },
    async ({ command, env }, { sessionId }) => {
      const backend = await getBackend(sessionId) as FileBasedBackend
      const result = await backend.exec(command, env ? { env } : undefined)
      return {
        content: [{ type: 'text', text: result as string }]
      }
    }
  )
}

/**
 * Shell-escape a string for safe inclusion in a bash -c command.
 * Wraps in single quotes and escapes existing single quotes via '\''.
 */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`
}

/**
 * Register grep tool on an MCP server. Shells out to ripgrep via the backend's
 * exec capability. Should only be called for backends with exec (FileBasedBackend).
 */
export function registerGrepTool(server: McpServer, getBackend: BackendGetter): void {
  server.registerTool(
    'grep',
    {
      description: 'Search file contents with ripgrep (rg). Returns matching file paths, per-file match counts, or match content. Respects .gitignore by default. Parameter shape mirrors Claude Code\'s Grep tool.',
      inputSchema: {
        pattern: z.string().describe('Regex pattern to search for'),
        path: z.string().optional().describe('File or directory to search in. Defaults to the workspace root.'),
        glob: z.string().optional().describe('Glob to filter which files are searched (e.g. "*.ts", "src/**/*.py")'),
        type: z.string().optional().describe('Ripgrep file-type name (e.g. "js", "py", "rust"). See `rg --type-list`.'),
        outputMode: z.enum(['content', 'files_with_matches', 'count']).optional()
          .describe('"files_with_matches" (default) returns matching paths; "count" returns per-file match counts; "content" returns matching lines.'),
        caseInsensitive: z.boolean().optional().describe('Case-insensitive matching (rg -i).'),
        multiline: z.boolean().optional().describe('Allow patterns to match across newlines (rg -U --multiline-dotall).'),
        contextBefore: z.number().int().min(0).optional().describe('Lines of context before each match (rg -B). Content mode only.'),
        contextAfter: z.number().int().min(0).optional().describe('Lines of context after each match (rg -A). Content mode only.'),
        contextAround: z.number().int().min(0).optional().describe('Lines of context around each match (rg -C). Content mode only. Mutually exclusive with contextBefore/contextAfter.'),
        lineNumbers: z.boolean().optional().describe('Prefix content-mode output with line numbers (rg -n). Ignored for other output modes.'),
        headLimit: z.number().int().positive().optional().describe('Cap result to the first N output lines (applied after search).'),
      },
    },
    async (args, { sessionId }) => {
      const {
        pattern, path: searchPath, glob, type,
        outputMode: outputModeParam,
        caseInsensitive, multiline,
        contextBefore, contextAfter, contextAround,
        lineNumbers, headLimit,
      } = args

      const outputMode = outputModeParam ?? 'files_with_matches'

      if (contextAround != null && (contextBefore != null || contextAfter != null)) {
        throw new Error('contextAround is mutually exclusive with contextBefore/contextAfter')
      }
      if (outputMode !== 'content' && (contextBefore != null || contextAfter != null || contextAround != null)) {
        throw new Error('context parameters are only valid with outputMode: "content"')
      }

      const rgArgs: string[] = ['--color=never', '--no-heading', '--with-filename']
      if (caseInsensitive) rgArgs.push('-i')
      if (multiline) rgArgs.push('-U', '--multiline-dotall')

      if (outputMode === 'files_with_matches') rgArgs.push('-l')
      else if (outputMode === 'count') rgArgs.push('-c')
      else if (outputMode === 'content' && lineNumbers) rgArgs.push('-n')

      if (contextAround != null) rgArgs.push('-C', String(contextAround))
      else {
        if (contextBefore != null) rgArgs.push('-B', String(contextBefore))
        if (contextAfter != null) rgArgs.push('-A', String(contextAfter))
      }

      if (glob) rgArgs.push('--glob', glob)
      if (type) rgArgs.push('--type', type)

      rgArgs.push('--', pattern)
      if (searchPath) rgArgs.push(searchPath)

      // `rg` exits 1 when it finds no matches; wrap so that only exit 0 means
      // "found results" and exit 1 means "real rg error". Exit 2 from rg gets
      // remapped to 1 by the wrapper, and its stderr is what exec surfaces.
      const rgCmd = ['rg', ...rgArgs.map(shellEscape)].join(' ')
      const shellCmd = `${rgCmd} || [ $? -eq 1 ]`

      const backend = await getBackend(sessionId) as FileBasedBackend
      let output: string
      try {
        output = await backend.exec(shellCmd) as string
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.includes('exit code 127') || /rg:\s+(command\s+)?not found/i.test(msg)) {
          throw new Error('grep requires ripgrep (rg) to be installed. Install via `apt install ripgrep`, `brew install ripgrep`, or use the agentbe-daemon Docker image.')
        }
        throw err
      }

      if (output === '') {
        return { content: [{ type: 'text', text: 'No matches found' }] }
      }

      const lines = output.split('\n')
      if (headLimit != null && lines.length > headLimit) {
        const kept = lines.slice(0, headLimit)
        kept.push(`[output truncated to first ${headLimit} lines; ${lines.length - headLimit} more hidden]`)
        return { content: [{ type: 'text', text: kept.join('\n') }] }
      }

      return { content: [{ type: 'text', text: output }] }
    }
  )
}
