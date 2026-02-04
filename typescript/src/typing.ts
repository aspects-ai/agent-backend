/**
 * Type guards and runtime type checking utilities for backends
 *
 * These functions provide type-safe runtime checks for determining
 * backend capabilities and properties.
 */

import type { Backend, FileBasedBackend, ScopedBackend } from './backends/types.js'

/**
 * Any backend type that can be passed around.
 *
 * Note: ScopedBackend doesn't extend Backend (it's missing destroy()),
 * so we need the union type to accept both.
 */
export type AnyBackend = Backend | ScopedBackend<FileBasedBackend>

/**
 * Backend with a rootDir property
 */
export type BackendWithRootDir = AnyBackend & { rootDir: string }

/**
 * Remote backend config shape
 */
export interface RemoteBackendConfig {
  host: string
  mcpPort?: number
  mcpServerHostOverride?: string
  mcpAuth?: { token: string }
}

/**
 * Backend with remote config
 */
export type BackendWithRemoteConfig = AnyBackend & { config: RemoteBackendConfig }

/**
 * Type guard: Check if a backend has a rootDir property
 *
 * @example
 * ```typescript
 * if (hasRootDir(backend)) {
 *   console.log(backend.rootDir) // TypeScript knows rootDir exists
 * }
 * ```
 */
export function hasRootDir(backend: AnyBackend): backend is BackendWithRootDir {
  return 'rootDir' in backend && typeof (backend as { rootDir?: unknown }).rootDir === 'string'
}

/**
 * Type guard: Check if a backend is a scoped backend
 *
 * @example
 * ```typescript
 * if (isScopedBackend(backend)) {
 *   console.log(backend.scopePath) // TypeScript knows it's a ScopedBackend
 *   console.log(backend.parent)
 * }
 * ```
 */
export function isScopedBackend(backend: AnyBackend): backend is ScopedBackend<FileBasedBackend> {
  return 'parent' in backend && 'scopePath' in backend
}

/**
 * Type guard: Check if a backend is a file-based backend (not just base Backend)
 *
 * @example
 * ```typescript
 * if (isFileBasedBackend(backend)) {
 *   await backend.read('file.txt')
 *   await backend.exec('ls')
 * }
 * ```
 */
export function isFileBasedBackend(backend: AnyBackend): backend is FileBasedBackend {
  return 'rootDir' in backend &&
         'read' in backend &&
         'write' in backend &&
         'exec' in backend &&
         'destroy' in backend &&
         typeof (backend as { read?: unknown }).read === 'function'
}

/**
 * Type guard: Check if a backend has remote config (RemoteFilesystemBackend)
 *
 * @example
 * ```typescript
 * if (hasRemoteConfig(backend)) {
 *   console.log(backend.config.host)
 *   console.log(backend.config.mcpPort)
 * }
 * ```
 */
export function hasRemoteConfig(backend: AnyBackend): backend is BackendWithRemoteConfig {
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
export function getRootBackend(backend: AnyBackend): Backend {
  if (!isScopedBackend(backend)) {
    return backend
  }

  // Traverse up the parent chain
  let current = backend.parent
  while (isScopedBackend(current)) {
    current = current.parent
  }
  // After the loop, current is the root FileBasedBackend (which extends Backend)
  return current as Backend
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
