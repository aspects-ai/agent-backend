import { backendManager } from '@/lib/backend'
import type { FileItem, FileTreeResponse } from '@/lib/types'
import { DEFAULT_EXCLUDE_PATTERNS, FileBasedBackend } from 'agent-backend'
import { NextRequest, NextResponse } from 'next/server'

// Convert DEFAULT_EXCLUDE_PATTERNS to a Set for fast lookup
const EXCLUDED_NAMES = new Set(DEFAULT_EXCLUDE_PATTERNS.filter(p => !p.includes('*')))
const EXCLUDED_SUFFIXES = DEFAULT_EXCLUDE_PATTERNS.filter(p => p.startsWith('*.')).map(p => p.slice(1))

function shouldExclude(filename: string): boolean {
  // Check exact match
  if (EXCLUDED_NAMES.has(filename)) return true
  // Check suffix patterns (e.g., *.egg-info)
  return EXCLUDED_SUFFIXES.some(suffix => filename.endsWith(suffix))
}

async function buildFileTree(backend: FileBasedBackend, dirPath: string): Promise<FileItem[]> {
  // readdirWithStats returns entries with stats in one call
  // Much more efficient for remote backends (SFTP returns all attrs with readdir)
  const entries = await backend.readdirWithStats(dirPath)
  const items: FileItem[] = []

  for (const { name, stats } of entries) {
    // Skip excluded patterns (gitignore-style: matches at any depth)
    if (shouldExclude(name)) continue

    const fullPath = dirPath === '.' ? name : `${dirPath}/${name}`

    // mtime can be a Date (local fs) or number/Unix timestamp (SFTP)
    const mtime = stats.mtime instanceof Date
      ? stats.mtime.toISOString()
      : new Date((stats.mtime as number) * 1000).toISOString()

    const item: FileItem = {
      name,
      path: fullPath,
      type: stats.isDirectory() ? 'directory' : 'file',
      size: stats.size,
      mtime,
    }

    if (stats.isDirectory()) {
      try {
        item.children = await buildFileTree(backend, fullPath)
      } catch {
        // Skip directories we can't read
        item.children = []
      }
    }

    items.push(item)
  }

  return items.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1
    }
    return a.name.localeCompare(b.name)
  })
}

export async function GET(req: NextRequest) {
  const sessionId = req.nextUrl.searchParams.get('sessionId')

  if (!sessionId) {
    return NextResponse.json(
      { error: 'sessionId required' },
      { status: 400 }
    )
  }

  try {
    const backend = await backendManager.getBackend()
    const files = await buildFileTree(backend, '.')

    const response: FileTreeResponse = { files }
    return NextResponse.json(response)
  } catch (error) {
    console.error('Error listing files:', error)
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to list files'
      },
      { status: 500 }
    )
  }
}
