import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { InMemoryBlobStore, InMemoryRoomStore } from "@agentbe/versioned-store";
import { HashingEmbeddingProvider, InMemoryVectorStore } from "@agentbe/index-sync";
import { beforeAll, describe, expect, it } from "vitest";

import {
  DockerWorkspaceProvider,
  RoomService,
  createRoomMcpServer,
  isDockerAvailable,
} from "../src/index.js";

const run = promisify(execFile);

/** Container ids currently running as room sandboxes. */
async function sandboxContainers(): Promise<string[]> {
  const { stdout } = await run("docker", ["ps", "-q", "--filter", "label=agentbe.room.sandbox"]);
  return stdout.trim().split("\n").filter(Boolean);
}

/**
 * Exercises the real sandbox: a per-session `agentbe-daemon` container reached
 * over `RemoteFilesystemBackend`. Requires a running Docker daemon and pulls the
 * published image on first run, so it lives in the integration suite
 * (`pnpm --filter @agentbe/room test:integration`), not the default unit run.
 */
const ROOM = "docker-room";
let dockerUp = false;

beforeAll(async () => {
  dockerUp = await isDockerAvailable();
});

describe.runIf(process.env.AGENTBE_DOCKER_TESTS === "1")("DockerWorkspaceProvider", () => {
  function makeService(): RoomService {
    return new RoomService({
      blobs: new InMemoryBlobStore(),
      rooms: new InMemoryRoomStore(),
      embedder: new HashingEmbeddingProvider(),
      vectors: new InMemoryVectorStore(),
      workspaces: new DockerWorkspaceProvider({ platform: process.env.AGENTBE_SANDBOX_PLATFORM }),
    });
  }

  it("runs the full loop inside a container and commits back", async () => {
    expect(dockerUp, "Docker daemon must be reachable for this suite").toBe(true);
    const service = makeService();
    await service.putDocuments(ROOM, { "data.txt": "one\ntwo\nthree\n" }, "seed");

    const session = await service.openSession(ROOM, {});
    try {
      // Checked-out content is really present inside the container.
      const wc = await session.exec("wc -l < data.txt");
      expect(String(wc).trim()).toBe("3");

      // It is a *different* machine than the host — proves we're not on the
      // local temp-dir provider by accident.
      const uname = String(await session.exec("cat /etc/os-release")).toLowerCase();
      expect(uname).toContain("ubuntu");

      // Warm state persists across commands, then commits back to the room.
      await session.exec("echo from-container > made-in-sandbox.txt");
      const ref = await session.commit("docker-test");
      expect(ref).toBeTruthy();
    } finally {
      await session.close();
    }

    const docs = await service.listDocuments(ROOM);
    expect(docs).toContain("made-in-sandbox.txt");
  }, 180_000);

  it("isolates concurrent sessions from each other", async () => {
    expect(dockerUp).toBe(true);
    const service = makeService();
    await service.putDocuments(ROOM, { "shared.txt": "shared\n" }, "seed");

    // Two sessions live at once — this is the case container-per-session exists
    // to protect, and the one a shared daemon with scope paths would NOT.
    const [a, b] = await Promise.all([service.openSession(ROOM, {}), service.openSession(ROOM, {})]);
    try {
      await a.exec("echo secret-from-a > private-a.txt");
      await b.exec("echo secret-from-b > private-b.txt");

      // Neither can see the other's file...
      expect(String(await a.exec("cat private-b.txt 2>&1 || true"))).not.toContain("secret-from-b");
      expect(String(await b.exec("cat private-a.txt 2>&1 || true"))).not.toContain("secret-from-a");

      // ...and each still sees its own.
      expect(String(await a.exec("cat private-a.txt"))).toContain("secret-from-a");
      expect(String(await b.exec("cat private-b.txt"))).toContain("secret-from-b");

      // Different machines entirely, not two directories on one.
      const hostA = String(await a.exec("hostname")).trim();
      const hostB = String(await b.exec("hostname")).trim();
      expect(hostA).not.toBe(hostB);
    } finally {
      await Promise.all([a.close(), b.close()]);
    }
  }, 240_000);

  it("removes the container on dispose", async () => {
    expect(dockerUp).toBe(true);
    const provider = new DockerWorkspaceProvider({ platform: process.env.AGENTBE_SANDBOX_PLATFORM });
    const provisioned = await provider.create();
    await provisioned.backend.exec("echo alive");
    await provisioned.dispose();
    // A second dispose must not throw — cleanup is best-effort and idempotent.
    await provisioned.dispose();
  }, 180_000);

  it("the idle reaper actually destroys the container, not just the handle", async () => {
    expect(dockerUp).toBe(true);
    const service = makeService();
    await service.putDocuments(ROOM, { "x.txt": "x" }, "seed");

    // The reaper was built and tested against temp dirs. Under Docker a missed
    // reap leaves a container running and billing, so assert on Docker's own
    // view of the world rather than on our bookkeeping.
    const server = createRoomMcpServer(service, ROOM, { sessionIdleMs: 3_000 });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "reaper-docker", version: "0.0.0" });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const before = await sandboxContainers();
    const opened = await client.callTool({ name: "open_session", arguments: {} });
    const { session } = JSON.parse(
      ((opened as { content: Array<{ text?: string }> }).content ?? [])
        .map((c) => c.text ?? "")
        .join(""),
    ) as { session: string };

    const during = await sandboxContainers();
    expect(during.length).toBe(before.length + 1);
    const mine = during.find((id) => !before.includes(id))!;
    expect(mine).toBeTruthy();

    // Go idle past the TTL without ever calling close_session.
    const deadline = Date.now() + 60_000;
    let stillUp = true;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1_000));
      stillUp = (await sandboxContainers()).includes(mine);
      if (!stillUp) break;
    }
    expect(stillUp, `container ${mine.slice(0, 12)} outlived the idle TTL`).toBe(false);

    // And the session is gone from the server's view too.
    const after = await client.callTool({
      name: "run_command",
      arguments: { session, command: "echo hi" },
    });
    expect(JSON.stringify(after)).toMatch(/unknown or closed session/);
    await client.close();
  }, 240_000);
});
