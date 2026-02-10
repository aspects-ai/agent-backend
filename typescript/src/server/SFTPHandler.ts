/**
 * SFTP Handler
 *
 * Implements SFTP protocol handling for the SSH-over-WebSocket server.
 * Provides file operations (read, write, list, stat, etc.) over SFTP.
 */

import type { SFTPWrapper, FileEntry, Attributes } from 'ssh2'
import {
  readdir,
  stat,
  lstat,
  mkdir,
  rmdir,
  unlink,
  rename,
  realpath,
  open as fsOpen,
  FileHandle
} from 'fs/promises'
import { constants as fsConstants } from 'fs'
import { join, resolve, dirname } from 'path'

// SFTP status codes
const SFTP_STATUS = {
  OK: 0,
  EOF: 1,
  NO_SUCH_FILE: 2,
  PERMISSION_DENIED: 3,
  FAILURE: 4,
  BAD_MESSAGE: 5,
  NO_CONNECTION: 6,
  CONNECTION_LOST: 7,
  OP_UNSUPPORTED: 8
} as const

// SFTP open flags
const SFTP_OPEN_FLAGS = {
  READ: 0x00000001,
  WRITE: 0x00000002,
  APPEND: 0x00000004,
  CREAT: 0x00000008,
  TRUNC: 0x00000010,
  EXCL: 0x00000020
} as const

// Handle types
interface FileHandleData {
  type: 'file'
  path: string
  handle: FileHandle
  flags: number
}

interface DirHandleData {
  type: 'dir'
  path: string
  entries: string[]
  index: number
}

type HandleData = FileHandleData | DirHandleData

/**
 * Create an SFTP handler for the given SFTP stream
 *
 * @param sftp - The SFTP stream from ssh2
 * @param rootDir - Root directory for all operations (paths are jailed to this)
 */
export function createSFTPHandler(sftp: SFTPWrapper, rootDir: string): void {
  const handles = new Map<number, HandleData>()
  let nextHandleId = 1

  /**
   * Resolve and validate path is within rootDir
   *
   * Path handling conventions:
   * - Relative paths (e.g., ".", "subdir/file"): resolved relative to rootDir
   * - Absolute paths matching rootDir (e.g., "/var/workspace/file" when rootDir is "/var/workspace"): used directly
   * - Absolute paths not matching rootDir (e.g., "/other/file"): treated as relative to rootDir
   */
  function resolvePath(requestedPath: string): string {
    let resolved: string

    // Normalize rootDir to ensure consistent comparison
    const normalizedRoot = resolve(rootDir)

    // Check if path already starts with rootDir (absolute path within workspace)
    if (requestedPath.startsWith(normalizedRoot + '/') || requestedPath === normalizedRoot) {
      resolved = resolve(requestedPath)
    } else {
      // Treat as relative to rootDir (strip leading slashes first)
      const normalizedPath = requestedPath.replace(/^\/+/, '')
      resolved = resolve(rootDir, normalizedPath)
    }

    // Security: ensure path doesn't escape rootDir
    if (!resolved.startsWith(normalizedRoot + '/') && resolved !== normalizedRoot) {
      throw new Error('Path escape attempt blocked')
    }

    return resolved
  }

  /**
   * Allocate a handle and return its buffer representation
   */
  function allocHandle(data: HandleData): Buffer {
    const id = nextHandleId++
    handles.set(id, data)
    const buf = Buffer.alloc(4)
    buf.writeUInt32BE(id, 0)
    return buf
  }

  /**
   * Get handle data from buffer
   */
  function getHandle(handleBuf: Buffer): HandleData | undefined {
    if (handleBuf.length < 4) return undefined
    const id = handleBuf.readUInt32BE(0)
    return handles.get(id)
  }

  /**
   * Free a handle
   */
  function freeHandle(handleBuf: Buffer): void {
    if (handleBuf.length < 4) return
    const id = handleBuf.readUInt32BE(0)
    handles.delete(id)
  }

  /**
   * Convert fs.Stats to SFTP Attributes
   */
  function statsToAttrs(stats: import('fs').Stats): Attributes {
    return {
      mode: stats.mode,
      uid: stats.uid,
      gid: stats.gid,
      size: stats.size,
      atime: Math.floor(stats.atimeMs / 1000),
      mtime: Math.floor(stats.mtimeMs / 1000)
    }
  }

  /**
   * Convert SFTP flags to Node.js open flags
   */
  function sftpFlagsToNodeFlags(sftpFlags: number): number {
    let flags = 0

    const hasRead = (sftpFlags & SFTP_OPEN_FLAGS.READ) !== 0
    const hasWrite = (sftpFlags & SFTP_OPEN_FLAGS.WRITE) !== 0

    if (hasRead && hasWrite) {
      flags = fsConstants.O_RDWR
    } else if (hasWrite) {
      flags = fsConstants.O_WRONLY
    } else {
      flags = fsConstants.O_RDONLY
    }

    if (sftpFlags & SFTP_OPEN_FLAGS.CREAT) flags |= fsConstants.O_CREAT
    if (sftpFlags & SFTP_OPEN_FLAGS.TRUNC) flags |= fsConstants.O_TRUNC
    if (sftpFlags & SFTP_OPEN_FLAGS.EXCL) flags |= fsConstants.O_EXCL
    if (sftpFlags & SFTP_OPEN_FLAGS.APPEND) flags |= fsConstants.O_APPEND

    return flags
  }

  // ─────────────────────────────────────────────────────────────────
  // File Operations
  // ─────────────────────────────────────────────────────────────────

  sftp.on('OPEN', async (reqid, filename, flags, attrs) => {
    try {
      const path = resolvePath(filename)
      const nodeFlags = sftpFlagsToNodeFlags(flags)
      const mode = attrs.mode ?? 0o644

      // Ensure parent directory exists for write operations
      if (flags & (SFTP_OPEN_FLAGS.WRITE | SFTP_OPEN_FLAGS.CREAT)) {
        const parentDir = dirname(path)
        await mkdir(parentDir, { recursive: true }).catch(() => {})
      }

      const handle = await fsOpen(path, nodeFlags, mode)

      const handleBuf = allocHandle({
        type: 'file',
        path,
        handle,
        flags
      })

      sftp.handle(reqid, handleBuf)
    } catch (err: any) {
      const status = err.code === 'ENOENT'
        ? SFTP_STATUS.NO_SUCH_FILE
        : err.code === 'EACCES'
          ? SFTP_STATUS.PERMISSION_DENIED
          : SFTP_STATUS.FAILURE
      sftp.status(reqid, status, err.message)
    }
  })

  sftp.on('READ', async (reqid, handleBuf, offset, length) => {
    try {
      const handleData = getHandle(handleBuf)
      if (!handleData || handleData.type !== 'file') {
        sftp.status(reqid, SFTP_STATUS.FAILURE, 'Invalid handle')
        return
      }

      const buffer = Buffer.alloc(length)
      const { bytesRead } = await handleData.handle.read(buffer, 0, length, offset)

      if (bytesRead === 0) {
        sftp.status(reqid, SFTP_STATUS.EOF)
      } else {
        sftp.data(reqid, buffer.subarray(0, bytesRead))
      }
    } catch (err: any) {
      sftp.status(reqid, SFTP_STATUS.FAILURE, err.message)
    }
  })

  sftp.on('WRITE', async (reqid, handleBuf, offset, data) => {
    try {
      const handleData = getHandle(handleBuf)
      if (!handleData || handleData.type !== 'file') {
        sftp.status(reqid, SFTP_STATUS.FAILURE, 'Invalid handle')
        return
      }

      await handleData.handle.write(data, 0, data.length, offset)
      sftp.status(reqid, SFTP_STATUS.OK)
    } catch (err: any) {
      sftp.status(reqid, SFTP_STATUS.FAILURE, err.message)
    }
  })

  sftp.on('CLOSE', async (reqid, handleBuf) => {
    try {
      const handleData = getHandle(handleBuf)
      if (handleData?.type === 'file') {
        await handleData.handle.close()
      }
      freeHandle(handleBuf)
      sftp.status(reqid, SFTP_STATUS.OK)
    } catch (err: any) {
      sftp.status(reqid, SFTP_STATUS.FAILURE, err.message)
    }
  })

  sftp.on('FSTAT', async (reqid, handleBuf) => {
    try {
      const handleData = getHandle(handleBuf)
      if (!handleData || handleData.type !== 'file') {
        sftp.status(reqid, SFTP_STATUS.FAILURE, 'Invalid handle')
        return
      }

      const stats = await handleData.handle.stat()
      sftp.attrs(reqid, statsToAttrs(stats))
    } catch (err: any) {
      sftp.status(reqid, SFTP_STATUS.FAILURE, err.message)
    }
  })

  // ─────────────────────────────────────────────────────────────────
  // Directory Operations
  // ─────────────────────────────────────────────────────────────────

  sftp.on('OPENDIR', async (reqid, path) => {
    try {
      const resolved = resolvePath(path)
      const entries = await readdir(resolved)

      const handleBuf = allocHandle({
        type: 'dir',
        path: resolved,
        entries,
        index: 0
      })

      sftp.handle(reqid, handleBuf)
    } catch (err: any) {
      const status = err.code === 'ENOENT'
        ? SFTP_STATUS.NO_SUCH_FILE
        : SFTP_STATUS.FAILURE
      sftp.status(reqid, status, err.message)
    }
  })

  sftp.on('READDIR', async (reqid, handleBuf) => {
    try {
      const handleData = getHandle(handleBuf)
      if (!handleData || handleData.type !== 'dir') {
        sftp.status(reqid, SFTP_STATUS.FAILURE, 'Invalid handle')
        return
      }

      const { entries, index, path } = handleData
      if (index >= entries.length) {
        sftp.status(reqid, SFTP_STATUS.EOF)
        return
      }

      // Return up to 50 entries at a time
      const batchSize = 50
      const batch = entries.slice(index, index + batchSize)
      handleData.index = index + batch.length

      const names: FileEntry[] = await Promise.all(
        batch.map(async (name) => {
          const fullPath = join(path, name)
          try {
            const stats = await lstat(fullPath)
            return {
              filename: name,
              longname: formatLongname(name, stats),
              attrs: statsToAttrs(stats) as Attributes
            }
          } catch {
            // If stat fails, return minimal info
            return {
              filename: name,
              longname: `?????????? ? ? ? ? ? ${name}`,
              attrs: {} as Attributes
            }
          }
        })
      )

      sftp.name(reqid, names)
    } catch (err: any) {
      sftp.status(reqid, SFTP_STATUS.FAILURE, err.message)
    }
  })

  // ─────────────────────────────────────────────────────────────────
  // Path Operations
  // ─────────────────────────────────────────────────────────────────

  sftp.on('STAT', async (reqid, path) => {
    try {
      const resolved = resolvePath(path)
      const stats = await stat(resolved)
      sftp.attrs(reqid, statsToAttrs(stats))
    } catch (err: any) {
      const status = err.code === 'ENOENT'
        ? SFTP_STATUS.NO_SUCH_FILE
        : SFTP_STATUS.FAILURE
      sftp.status(reqid, status, err.message)
    }
  })

  sftp.on('LSTAT', async (reqid, path) => {
    try {
      const resolved = resolvePath(path)
      const stats = await lstat(resolved)
      sftp.attrs(reqid, statsToAttrs(stats))
    } catch (err: any) {
      const status = err.code === 'ENOENT'
        ? SFTP_STATUS.NO_SUCH_FILE
        : SFTP_STATUS.FAILURE
      sftp.status(reqid, status, err.message)
    }
  })

  sftp.on('REALPATH', async (reqid, path) => {
    try {
      const resolved = resolvePath(path)

      // Return path relative to rootDir (as seen by client)
      let real: string
      try {
        real = await realpath(resolved)
      } catch {
        // Path doesn't exist yet, return normalized path
        real = resolved
      }

      // Convert back to client-visible path
      const clientPath = real.startsWith(rootDir)
        ? '/' + real.slice(rootDir.length).replace(/^\/+/, '')
        : '/'

      sftp.name(reqid, [{
        filename: clientPath || '/',
        longname: clientPath || '/',
        attrs: {} as Attributes
      }])
    } catch (err: any) {
      sftp.status(reqid, SFTP_STATUS.FAILURE, err.message)
    }
  })

  sftp.on('MKDIR', async (reqid, path, attrs) => {
    try {
      const resolved = resolvePath(path)
      await mkdir(resolved, { mode: attrs.mode ?? 0o755 })
      sftp.status(reqid, SFTP_STATUS.OK)
    } catch (err: any) {
      const status = err.code === 'EEXIST'
        ? SFTP_STATUS.FAILURE
        : SFTP_STATUS.FAILURE
      sftp.status(reqid, status, err.message)
    }
  })

  sftp.on('RMDIR', async (reqid, path) => {
    try {
      const resolved = resolvePath(path)
      await rmdir(resolved)
      sftp.status(reqid, SFTP_STATUS.OK)
    } catch (err: any) {
      const status = err.code === 'ENOENT'
        ? SFTP_STATUS.NO_SUCH_FILE
        : SFTP_STATUS.FAILURE
      sftp.status(reqid, status, err.message)
    }
  })

  sftp.on('REMOVE', async (reqid, path) => {
    try {
      const resolved = resolvePath(path)
      await unlink(resolved)
      sftp.status(reqid, SFTP_STATUS.OK)
    } catch (err: any) {
      const status = err.code === 'ENOENT'
        ? SFTP_STATUS.NO_SUCH_FILE
        : SFTP_STATUS.FAILURE
      sftp.status(reqid, status, err.message)
    }
  })

  sftp.on('RENAME', async (reqid, oldPath, newPath) => {
    try {
      const resolvedOld = resolvePath(oldPath)
      const resolvedNew = resolvePath(newPath)

      // Ensure parent directory exists
      await mkdir(dirname(resolvedNew), { recursive: true }).catch(() => {})

      await rename(resolvedOld, resolvedNew)
      sftp.status(reqid, SFTP_STATUS.OK)
    } catch (err: any) {
      const status = err.code === 'ENOENT'
        ? SFTP_STATUS.NO_SUCH_FILE
        : SFTP_STATUS.FAILURE
      sftp.status(reqid, status, err.message)
    }
  })

  sftp.on('SETSTAT', async (reqid, path, attrs) => {
    // Set file attributes - we support a subset
    try {
      const resolved = resolvePath(path)

      // chmod if mode is specified
      if (attrs.mode !== undefined) {
        const { chmod } = await import('fs/promises')
        await chmod(resolved, attrs.mode)
      }

      // chown if uid/gid specified (requires root)
      if (attrs.uid !== undefined || attrs.gid !== undefined) {
        const { chown } = await import('fs/promises')
        const currentStats = await stat(resolved)
        await chown(
          resolved,
          attrs.uid ?? currentStats.uid,
          attrs.gid ?? currentStats.gid
        ).catch(() => {}) // Ignore permission errors
      }

      // utimes if atime/mtime specified
      if (attrs.atime !== undefined || attrs.mtime !== undefined) {
        const { utimes } = await import('fs/promises')
        const currentStats = await stat(resolved)
        await utimes(
          resolved,
          attrs.atime ?? Math.floor(currentStats.atimeMs / 1000),
          attrs.mtime ?? Math.floor(currentStats.mtimeMs / 1000)
        ).catch(() => {})
      }

      sftp.status(reqid, SFTP_STATUS.OK)
    } catch (err: any) {
      sftp.status(reqid, SFTP_STATUS.FAILURE, err.message)
    }
  })

  sftp.on('FSETSTAT', async (reqid, handleBuf, attrs) => {
    try {
      const handleData = getHandle(handleBuf)
      if (!handleData || handleData.type !== 'file') {
        sftp.status(reqid, SFTP_STATUS.FAILURE, 'Invalid handle')
        return
      }

      // chmod if mode is specified
      if (attrs.mode !== undefined) {
        await handleData.handle.chmod(attrs.mode)
      }

      // chown if uid/gid specified
      if (attrs.uid !== undefined || attrs.gid !== undefined) {
        const currentStats = await handleData.handle.stat()
        await handleData.handle.chown(
          attrs.uid ?? currentStats.uid,
          attrs.gid ?? currentStats.gid
        ).catch(() => {})
      }

      sftp.status(reqid, SFTP_STATUS.OK)
    } catch (err: any) {
      sftp.status(reqid, SFTP_STATUS.FAILURE, err.message)
    }
  })
}

/**
 * Format a long name for directory listing (ls -l style)
 */
function formatLongname(name: string, stats: import('fs').Stats): string {
  const typeChar = stats.isDirectory() ? 'd' : stats.isSymbolicLink() ? 'l' : '-'
  const perms = formatPermissions(stats.mode)
  const nlink = stats.nlink.toString().padStart(3)
  const uid = stats.uid.toString().padStart(5)
  const gid = stats.gid.toString().padStart(5)
  const size = stats.size.toString().padStart(10)
  const date = formatDate(stats.mtime)

  return `${typeChar}${perms} ${nlink} ${uid} ${gid} ${size} ${date} ${name}`
}

/**
 * Format file permissions as rwxrwxrwx string
 */
function formatPermissions(mode: number): string {
  const chars = 'rwxrwxrwx'
  let result = ''
  for (let i = 0; i < 9; i++) {
    result += (mode & (1 << (8 - i))) ? chars[i] : '-'
  }
  return result
}

/**
 * Format date for ls output
 */
function formatDate(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const month = months[date.getMonth()]
  const day = date.getDate().toString().padStart(2)

  const now = new Date()
  const sixMonthsAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000)

  if (date > sixMonthsAgo) {
    // Recent: show time
    const hours = date.getHours().toString().padStart(2, '0')
    const mins = date.getMinutes().toString().padStart(2, '0')
    return `${month} ${day} ${hours}:${mins}`
  } else {
    // Old: show year
    return `${month} ${day}  ${date.getFullYear()}`
  }
}
