/**
 * Shared path validation utilities for backends
 * Used across LocalFilesystem, RemoteFilesystem, Memory backends
 */

import { PathEscapeError } from '../types.js'

/**
 * Validate that a path stays within a boundary and return combined path
 * Used for validating operations against rootDir or scope boundaries
 *
 * Absolute paths (e.g., /file.txt) are treated as relative to the boundary.
 * This allows users to specify paths like "/file.txt" which resolves to "boundary/file.txt".
 *
 * @param relativePath - The path to validate (can be relative or absolute)
 * @param boundary - The boundary path (rootDir or scopePath)
 * @param pathModule - path or path.posix module
 * @returns Combined path (boundary + relativePath)
 * @throws {PathEscapeError} if path escapes boundary
 *
 * @example
 * // Escape attempt - throws
 * validateWithinBoundary('../etc/passwd', '/app/workspace', path)
 * // Throws: PathEscapeError
 *
 * @example
 * // Scope escape - throws
 * validateWithinBoundary('../user2/secret', 'users/user1', path.posix)
 * // Throws: PathEscapeError
 *
 * @example
 * // Absolute path treated as relative to boundary
 * validateWithinBoundary('/file.txt', 'users/user1', path.posix)
 * // Returns: 'users/user1/file.txt'
 *
 * @example
 * // Valid relative path
 * validateWithinBoundary('subdir/file.txt', 'users/user1', path.posix)
 * // Returns: 'users/user1/subdir/file.txt'
 */
export function validateWithinBoundary(
  relativePath: string,
  boundary: string,
  pathModule: {
    isAbsolute: (path: string) => boolean
    join: (...paths: string[]) => string
    resolve: (...paths: string[]) => string
    sep: string
  }
): string {
  // Strip leading slash from absolute paths - treat as relative to boundary
  let normalizedPath = relativePath
  if (pathModule.isAbsolute(relativePath)) {
    // Remove leading slash(es) to make it relative
    normalizedPath = relativePath.replace(/^\/+/, '')
  }

  // Combine boundary with relative path
  const combined = pathModule.join(boundary, normalizedPath)

  // Normalize (remove .. and .) by resolving from root
  const resolved = pathModule.resolve('/', combined)
  const boundaryResolved = pathModule.resolve('/', boundary)

  // Validate stays within boundary
  // Must either start with boundary + separator, or equal the boundary exactly
  if (!resolved.startsWith(boundaryResolved + pathModule.sep) &&
      resolved !== boundaryResolved) {
    throw new PathEscapeError(relativePath)
  }

  return combined
}

/**
 * Validate that an absolute path stays within a root directory
 * Used when cwd or other absolute paths need validation
 *
 * @param absolutePath - The absolute path to validate
 * @param rootDir - The root directory boundary
 * @param pathModule - path or path.posix module
 * @throws {PathEscapeError} if path is outside rootDir
 *
 * @example
 * validateAbsoluteWithinRoot('/app/workspace/file.txt', '/app/workspace', path)
 * // OK
 *
 * @example
 * validateAbsoluteWithinRoot('/etc/passwd', '/app/workspace', path)
 * // Throws: PathEscapeError
 */
export function validateAbsoluteWithinRoot(
  absolutePath: string,
  rootDir: string,
  pathModule: {
    resolve: (...paths: string[]) => string
    sep: string
  }
): void {
  const normalizedPath = pathModule.resolve(absolutePath)
  const normalizedRoot = pathModule.resolve(rootDir)

  if (!normalizedPath.startsWith(normalizedRoot + pathModule.sep) &&
      normalizedPath !== normalizedRoot) {
    throw new PathEscapeError(absolutePath)
  }
}
