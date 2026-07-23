# @agentbe/versioned-store

> Content-addressed, S3-backed versioned document store with checkout / commit-back into an [agent-backend](../agent-backend) workspace.

**Status:** core + in-memory backends (unit-tested, 7) **and** S3 adapters (`S3BlobStore` + conditional-write `S3RoomStore`, integration-tested against LocalStack, 9 — incl. byte-exact round-trips of real JPEG/PNG/PDF/CSV fixtures) are implemented and green. Package name is a placeholder pending the published name.

Test tiers: `pnpm test:run` (fast, in-memory) · `pnpm test:integration` (needs a live S3 — `docker run -d -p 4566:4566 -e SERVICES=s3 localstack/localstack:3`; override endpoint via `AGENTBE_S3_ENDPOINT`).

## Model

A **room** is a sequence of immutable **manifests** (path → content-hash entry). **HEAD** is a pointer advanced by compare-and-swap, giving optimistic concurrency without a lock service. Blobs are content-addressed objects in S3 (dedupe + partial checkout for free).

A sandbox never edits the store directly. It works against an **ephemeral checkout** — a subset of a manifest materialized into an agent-backend workspace — and promotes state with **commit-back**: diff the working tree against the base manifest, upload new blobs, write a manifest, CAS HEAD. On conflict, resolve (per-file last-writer-wins for now) and retry.

## The coupling surface

The only thing this library needs from agent-backend is [`WorkingTree`](src/working-tree.ts) — read/write/readdir over a POSIX root. agent-backend's `FileBasedBackend` satisfies it structurally, so you pass a (scoped) `Backend` straight in. Keeping this surface thin is what keeps the two libraries independently useful.

## Interfaces

- `BlobStore` — immutable content-addressed blob storage (S3).
- `RoomStore` — HEAD/manifest metadata + the atomic CAS advance.
- `VersionedStore` — `checkout()` / `commit()`, composing the two against a `WorkingTree`.
