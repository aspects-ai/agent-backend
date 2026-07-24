import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { FsBlobStore, FsRoomStore, InMemoryBlobStore, InMemoryRoomStore } from "../src/index.js";

import { runStoreConformance } from "./support/conformance.js";

runStoreConformance("in-memory", () => ({
  blobs: new InMemoryBlobStore(),
  rooms: new InMemoryRoomStore(),
}));

runStoreConformance("fs", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vs-conformance-"));
  return {
    blobs: new FsBlobStore(dir),
    rooms: new FsRoomStore(dir),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
});
