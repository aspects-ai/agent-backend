import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { LocalFilesystemBackend } from "agent-backend";

import type { ProvisionedBackend, RoomBackend, WorkspaceProvider } from "./room-service.js";

/**
 * Provisions each workspace as a temp-dir {@link LocalFilesystemBackend}. Suits
 * local development and tests; production would use a Docker/daemon-backed
 * provider that returns a `RemoteFilesystemBackend`. Runs UNSANDBOXED — fine for
 * dev, or when the host is already isolated (k8s pod / VM).
 */
export class LocalWorkspaceProvider implements WorkspaceProvider {
  constructor(private readonly prefix = "agentbe-room-") {}

  async create(): Promise<ProvisionedBackend> {
    const dir = mkdtempSync(path.join(os.tmpdir(), this.prefix));
    const backend = new LocalFilesystemBackend({
      rootDir: dir,
      isolation: "none",
      preventDangerous: false,
    });
    return {
      backend: backend as RoomBackend,
      dispose: async () => {
        rmSync(dir, { recursive: true, force: true });
      },
    };
  }
}
