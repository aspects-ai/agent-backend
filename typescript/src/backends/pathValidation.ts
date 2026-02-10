/**
 * Shared path validation utilities for backends
 * Used across LocalFilesystem, RemoteFilesystem, Memory backends
 */

import { PathEscapeError } from '../types.js'

/**
 * Validate that a path stays within a boundary and return combined path
 * Used for validating operations against rootDir or scope boundaries
 *
 * Path handling conventions:
 * 1. Relative paths (e.g., "file.txt", "subdir/file"): resolved relative to boundary
 * 2. Absolute paths matching boundary (e.g., "/var/workspace/file" when boundary is "/var/workspace"):
 *    used directly (already within workspace)
 * 3. Absolute paths not matching boundary (e.g., "/other/file"): treated as relative to boundary
 *
 * @param relativePath - The path to validate (can be relative or absolute)
 * @param boundary - The boundary path (rootDir or scopePath)
 * @param pathModule - path or path.posix module
 * @returns Combined path (boundary + relativePath) or the absolute path if it matches boundary
 * @throws {PathEscapeError} if path escapes boundary
 *
 * @example
 * // Escape attempt - throws
 * validateWithinBoundary('../etc/passwd', '/app/workspace', path)
 * // Throws: PathEscapeError
 *
 * @example
 * // Absolute path matching boundary - used directly
 * validateWithinBoundary('/app/workspace/file.txt', '/app/workspace', path)
 * // Returns: '/app/workspace/file.txt'
 *
 * @example
 * // Absolute path not matching boundary - treated as relative
 * validateWithinBoundary('/file.txt', '/app/workspace', path)
 * // Returns: '/app/workspace/file.txt'
 *
 * @example
 * // Valid relative path
 * validateWithinBoundary('subdir/file.txt', '/app/workspace', path)
 * // Returns: '/app/workspace/subdir/file.txt'
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
  const boundaryResolved = pathModule.resolve('/', boundary)

  // Check if path is absolute and already within boundary
  if (pathModule.isAbsolute(relativePath)) {
    const pathResolved = pathModule.resolve('/', relativePath)

    // If absolute path starts with boundary, use it directly (after validation)
    if (pathResolved.startsWith(boundaryResolved + pathModule.sep) ||
        pathResolved === boundaryResolved) {
      return pathResolved
    }

    // Absolute path doesn't match boundary - treat as relative (strip leading slashes)
  }

  // Strip leading slash from absolute paths - treat as relative to boundary
  let normalizedPath = relativePath
  if (pathModule.isAbsolute(relativePath)) {
    normalizedPath = relativePath.replace(/^\/+/, '')
  }

  // Combine boundary with relative path
  const combined = pathModule.join(boundary, normalizedPath)

  // Normalize (remove .. and .) by resolving from root
  const resolved = pathModule.resolve('/', combined)

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
