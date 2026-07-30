/**
 * @agentbe/room
 *
 * The agent document room: a service layer composing a catalog, semantic
 * search, and agent-backend sandboxes. The bundled manifest catalog provides
 * the original search → checkout → exec → commit-back workspace loop; large
 * organizational catalogs can provide a database-backed adapter instead.
 */

export { RoomService, RoomSession } from "./room-service.js";
export type {
  RoomServiceDeps,
  ManifestRoomServiceDeps,
  CatalogRoomServiceDeps,
  RoomBackend,
  ProvisionedBackend,
  WorkspaceProvider,
  OpenSessionOptions,
} from "./room-service.js";
export { ManifestRoomCatalog } from "./manifest-room-catalog.js";
export type { ManifestRoomCatalogDeps } from "./manifest-room-catalog.js";
export type {
  RoomCatalog,
  RoomAccessContext,
  SearchModality,
  DocumentPage,
  ListDocumentsOptions,
  MaterializeOptions,
} from "./room-catalog.js";
export { LocalWorkspaceProvider } from "./workspace-local.js";
export { DockerWorkspaceProvider, isDockerAvailable, DEFAULT_DAEMON_IMAGE } from "./workspace-docker.js";
export type { DockerWorkspaceOptions } from "./workspace-docker.js";
export { K8sWorkspaceProvider, isInCluster } from "./workspace-k8s.js";
export type { K8sWorkspaceOptions } from "./workspace-k8s.js";
export { AgentSandboxWorkspaceProvider } from "./workspace-agent-sandbox.js";
export type { AgentSandboxWorkspaceOptions } from "./workspace-agent-sandbox.js";
export { AutoWorkspaceProvider } from "./workspace-auto.js";
export type { AutoWorkspaceOptions, WorkspaceMode } from "./workspace-auto.js";
export { BackendWorkingTree } from "./lib/backend-working-tree.js";
export type { BackendLike } from "./lib/backend-working-tree.js";
export { createRoomMcpServer, serveRoomStdio, ANONYMOUS_PRINCIPAL } from "./mcp/server.js";
export type { RoomMcpOptions } from "./mcp/server.js";
export { serveRoomHttp } from "./mcp/http.js";
export type { RoomHttpOptions, RoomHttpHandle } from "./mcp/http.js";
export { buildRoomService, seedRoomFromDir } from "./bootstrap.js";
export { createS3Stores } from "./stores-s3.js";
export type { S3StoreConfig } from "./stores-s3.js";
