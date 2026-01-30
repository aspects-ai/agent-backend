import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { minimatch } from 'minimatch'
import * as path from 'path'
import { z } from 'zod'
import type { Backend, FileBasedBackend } from 'constellationfs'

type BackendGetter = (sessionId?: string) => Promise<Backend> | Backend

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
      description: 'Read complete contents of a file as text',
      inputSchema: {
        path: z.string().describe('Path to the file'),
        head: z.number().nullable().describe('Return only the first N lines (null to ignore)'),
        tail: z.number().nullable().describe('Return only the last N lines (null to ignore)'),
      },
    },
    async ({ path: filePath, head, tail }, { sessionId }) => {
      // Cannot specify both head and tail
      if (head != null && tail != null) {
        throw new Error('Cannot specify both head and tail parameters simultaneously')
      }

      const backend = await getBackend(sessionId) as FileBasedBackend
      let content = await backend.read(filePath, { encoding: 'utf8' }) as string

      if (head != null) {
        const lines = content.split('\n')
        content = lines.slice(0, head).join('\n')
      } else if (tail != null) {
        const lines = content.split('\n')
        content = lines.slice(-tail).join('\n')
      }

      return { content: [{ type: 'text', text: content }] }
    }
  )

  server.registerTool(
    'read_media_file',
    {
      description: 'Read an image or audio file, returns base64 data with MIME type',
      inputSchema: {
        path: z.string().describe('Path to the media file'),
      },
    },
    async ({ path: filePath }, { sessionId }) => {
      const backend = await getBackend(sessionId) as FileBasedBackend
      const buffer = await backend.read(filePath, { encoding: 'buffer' }) as Buffer
      const mimeType = getMimeType(filePath)
      const base64 = buffer.toString('base64')

      // Determine content type based on MIME type (matches official MCP filesystem server)
      const contentType = mimeType.startsWith('image/')
        ? 'image'
        : mimeType.startsWith('audio/')
          ? 'audio'
          : 'blob' // Fallback for other binary types

      // Return proper MCP content block format
      // Note: 'blob' is not officially in the MCP spec but is used by the official filesystem server
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
      // to prevent race conditions. ConstellationFS's writeFile uses standard fs.writeFile.
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
      description: 'Make selective edits using exact text matching. Each edit replaces exact text sequences. Returns a unified diff showing changes made.',
      inputSchema: {
        path: z.string().describe('Path to the file'),
        edits: z.array(z.object({
          oldText: z.string().describe('Text to search for - must match exactly'),
          newText: z.string().describe('Text to replace with'),
        })).describe('Array of edits to apply'),
        dryRun: z.boolean().nullable()
          .describe('Preview changes using git-style diff format (null defaults to false)'),
      },
    },
    async ({ path: filePath, edits, dryRun: dryRunParam }, { sessionId }) => {
      const dryRun = dryRunParam ?? false
      const backend = await getBackend(sessionId) as FileBasedBackend
      const original = await backend.read(filePath, { encoding: 'utf8' }) as string

      // Normalize line endings for consistent matching
      const normalizeLineEndings = (text: string) => text.replace(/\r\n/g, '\n')
      let modified = normalizeLineEndings(original)

      for (const edit of edits) {
        const normalizedOld = normalizeLineEndings(edit.oldText)
        const normalizedNew = normalizeLineEndings(edit.newText)

        // Require exact match - throw error if not found (matches official behavior)
        if (!modified.includes(normalizedOld)) {
          throw new Error(`Could not find exact match for edit:\n${edit.oldText}`)
        }

        modified = modified.replace(normalizedOld, normalizedNew)
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
      description: 'List directory contents with [FILE] or [DIR] prefixes',
      inputSchema: {
        path: z.string().describe('Path to the directory'),
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
      description: 'List directory contents with prefixes, file sizes, and summary statistics',
      inputSchema: {
        path: z.string().describe('Path to the directory'),
        sortBy: z.enum(['name', 'size']).nullable()
          .describe('Sort entries by name or size (descending), null defaults to name'),
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
      description: 'Get recursive JSON tree structure of directory contents. Each entry includes name, type (file/directory), and children for directories.',
      inputSchema: {
        path: z.string().describe('Path to the directory'),
        excludePatterns: z.array(z.string()).nullable()
          .describe('Glob patterns to exclude (e.g., "node_modules", "*.log"), null defaults to empty'),
      },
    },
    async ({ path: dirPath, excludePatterns: excludePatternsParam }, { sessionId }) => {
      const excludePatterns = excludePatternsParam ?? []
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

      // Use exec for the actual move - path validation is handled by workspace
      // The backend.exists() calls above already validate the paths are within bounds
      await backend.exec(`mv "${source}" "${destination}"`)
      return {
        content: [{ type: 'text', text: `Moved ${source} to ${destination}` }]
      }
    }
  )

  server.registerTool(
    'search_files',
    {
      description: 'Recursively search for files and directories matching a glob pattern. Patterns match against paths relative to the search directory.',
      inputSchema: {
        path: z.string().describe('Starting directory path'),
        pattern: z.string().describe('Glob pattern to match (e.g., "*.ts", "**/*.js", "src/**/*.tsx")'),
        excludePatterns: z.array(z.string()).nullable()
          .describe('Patterns to exclude from results, null defaults to empty'),
      },
    },
    async ({ path: searchPath, pattern, excludePatterns: excludePatternsParam }, { sessionId }) => {
      const excludePatterns = excludePatternsParam ?? []
      const backend = await getBackend(sessionId) as FileBasedBackend
      const results: string[] = []

      // Recursive search function using minimatch for glob matching
      async function searchDir(currentPath: string): Promise<void> {
        const entries = await backend.readdir(currentPath) as string[]

        for (const entry of entries) {
          const fullPath = path.join(currentPath, entry)
          const relativePath = path.relative(searchPath, fullPath)

          // Check if this path should be excluded
          const shouldExclude = excludePatterns.some((excludePattern: string) =>
            minimatch(relativePath, excludePattern, { dot: true })
          )
          if (shouldExclude) continue

          // Check if this path matches the search pattern
          if (minimatch(relativePath, pattern, { dot: true })) {
            results.push(fullPath)
          }

          // Recurse into directories
          try {
            const stats = await backend.stat(fullPath)
            if (stats.isDirectory()) {
              await searchDir(fullPath)
            }
          } catch {
            // Skip inaccessible entries
          }
        }
      }

      await searchDir(searchPath)

      return {
        content: [{ type: 'text', text: results.length > 0 ? results.join('\n') : 'No matches found' }]
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
        env: z.record(z.string(), z.string()).nullable()
          .describe('Environment variables to set for this command, null for none'),
      },
    },
    async ({ command, env }, { sessionId }) => {
      const backend = await getBackend(sessionId) as FileBasedBackend
      const result = await backend.exec(command, env != null ? { env } : undefined)
      return {
        content: [{ type: 'text', text: result as string }]
      }
    }
  )
}
