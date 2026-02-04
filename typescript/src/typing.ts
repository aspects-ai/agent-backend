/**
 * Type guards and runtime type checking utilities for backends
 *
 * These functions provide type-safe runtime checks for determining
 * backend capabilities and properties.
 */

import type { Backend, FileBasedBackend, ScopedBackend } from './backends/types.js'
import type { RemoteFilesystemBackendConfig } from './backends/config.js'

/**
 * Type guard: Check if a backend is a file-based backend
 *
 * @example
 * ```typescript
 * if (isFileBasedBackend(backend)) {
 *   console.log(backend.rootDir)
 *   await backend.read('file.txt')
 * }
 * ```
 */
export function isFileBasedBackend(backend: Backend): backend is FileBasedBackend {
  return 'rootDir' in backend &&
         'read' in backend &&
         'write' in backend &&
         'exec' in backend &&
         typeof (backend as { read?: unknown }).read === 'function'
}

/**
 * Type guard: Check if a backend is a scoped backend
 *
 * @example
 * ```typescript
 * if (isScopedBackend(backend)) {
 *   console.log(backend.scopePath)
 *   console.log(backend.parent)
 * }
 * ```
 */
export function isScopedBackend<T extends FileBasedBackend = FileBasedBackend>(
  backend: Backend
): backend is ScopedBackend<T> {
  return 'parent' in backend && 'scopePath' in backend
}

/**
 * Type guard: Check if a backend has remote config (RemoteFilesystemBackend)
 * Uses duck typing since config is a private property on the class.
 *
 * @example
 * ```typescript
 * if (hasRemoteConfig(backend)) {
 *   console.log(backend.config.host)
 * }
 * ```
 */
export function hasRemoteConfig(
  backend: Backend
): backend is Backend & { config: RemoteFilesystemBackendConfig } {
  if (!('config' in backend)) return false
  const config = (backend as { config?: unknown }).config
  if (typeof config !== 'object' || config === null) return false
  return 'host' in config && typeof (config as { host?: unknown }).host === 'string'
}

/**
 * Get the root backend from a potentially scoped backend.
 * Traverses up the parent chain until reaching a non-scoped backend.
 *
 * @example
 * ```typescript
 * const root = getRootBackend(scopedBackend)
 * console.log(root.type) // The actual backend type
 * ```
 */
export function getRootBackend(backend: Backend): Backend {
  if (!isScopedBackend(backend)) {
    return backend
  }

  // Traverse up the parent chain
  let current: Backend = backend.parent
  while (isScopedBackend(current)) {
    current = current.parent
  }
  return current
}

/**
 * Safely access a property on an object using duck typing.
 * Returns undefined if the property doesn't exist.
 *
 * @example
 * ```typescript
 * const isolation = getProperty<string>(backend, 'isolation')
 * if (isolation) {
 *   console.log('Isolation mode:', isolation)
 * }
 * ```
 */
export function getProperty<V>(obj: object, key: string): V | undefined {
  if (key in obj) {
    return (obj as Record<string, V>)[key]
  }
  return undefined
}
