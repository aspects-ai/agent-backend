/**
 * SSH2 module wrapper for ESM/CJS interop
 *
 * This wrapper enables proper mocking in tests while
 * maintaining runtime compatibility with ssh2's CJS exports.
 */

import { createRequire } from 'module'
import type { Client as SSH2ClientType, Server as SSH2ServerType } from 'ssh2'

// Re-export types for use in type annotations
export type { Client as SSH2ClientType, Server as SSH2ServerType } from 'ssh2'

const require = createRequire(import.meta.url)
const ssh2 = require('ssh2') as {
  Client: typeof SSH2ClientType
  Server: typeof SSH2ServerType
}

export const SSH2Client = ssh2.Client
export const SSH2Server = ssh2.Server
