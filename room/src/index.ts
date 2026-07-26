/**
 * @agentbe/room
 *
 * The agent document room: a service layer composing agent-backend (sandbox),
 * versioned-store (S3 content-addressed versioning), and index-sync (semantic
 * search) into the search → checkout → exec → commit-back loop. This package is
 * the service core; the HTTP API / UI / auth wrap it.
 */

export { RoomService, RoomSession } from "./room-service.js";
export type {
  RoomServiceDeps,
  RoomBackend,
  ProvisionedBackend,
  WorkspaceProvider,
  OpenSessionOptions,
} from "./room-service.js";
export { LocalWorkspaceProvider } from "./workspace-local.js";
export { BackendWorkingTree } from "./lib/backend-working-tree.js";
export type { BackendLike } from "./lib/backend-working-tree.js";
export { createRoomMcpServer, serveRoomStdio } from "./mcp/server.js";
export { serveRoomHttp } from "./mcp/http.js";
export type { RoomHttpOptions, RoomHttpHandle } from "./mcp/http.js";
export { buildRoomService, seedRoomFromDir } from "./bootstrap.js";
