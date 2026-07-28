# Multi-room deploy — the production shape, locally

Boots several independent rooms the way a real deployment would: **one process
per room**, each with its own store, port, and principal tokens. Use it to
confirm that separate customers really are separated before you deploy.

## Why "multi-room", not "multi-tenant"

The tenant here is the **room**, not the organization — see
`specs/agent-document-room.md` §7. A room may legitimately span organizations
(two parties in a deal, with per-individual access), so org is deliberately *not*
a partition in the data model. Isolation comes from separate rooms and separate
credentials. Everything the room service does is already room-scoped: the store
lays out `rooms/<room>/HEAD` and `rooms/<room>/manifests/`, and the search index
is keyed per room.

## Run it

```bash
make rooms          # boot acme (:8861) and globex (:8862), Ctrl-C to stop
make rooms-test     # boot both, assert isolation, tear down

make rooms S3=1     # ...on the S3 tier (the production store), via LocalStack
make rooms-test S3=1
```

Without `S3=1` the rooms use the **filesystem** store, which pins each room to
this node's disk. With it they use **S3** (`S3BlobStore`/`S3RoomStore`) under a
per-room key prefix — the same code path a production deploy takes. The S3 run
reuses whatever LocalStack is already serving `:4566`, and `--reset` there uses a
fresh key prefix rather than deleting objects, so it can't touch data outside the
run.

Two rooms are defined at the top of `run.sh` as `name:port:token=principal,...`:

| Room | Port | Principals |
|---|---|---|
| `acme` | 8861 | `ada@acme.com`, `grace@acme.com` |
| `globex` | 8862 | `bob@globex.com` |

Each is seeded with a distinctly-named secret plus a `notes.md` that exists in
**both** rooms with different contents — so a cross-room leak is unmistakable
rather than subtle.

## What `make rooms-test` proves

- **Credentials don't cross.** `acme`'s token is rejected by `globex` and vice
  versa (a 401, not a silent empty result).
- **Content doesn't cross.** Neither room lists or reads the other's documents,
  and the shared `notes.md` path resolves to that room's own content.
- **Attribution is real and unforgeable.** A commit is recorded against the
  authenticated principal; a caller-supplied `author` is ignored.
- **Sandboxes are per-room.** Code executing in `acme`'s sandbox sees `acme`
  content and no `globex` content.

Pass `--no-sandbox` to `check.mjs` to skip the container step when you only want
the fast credential/content assertions.

## Production notes

This example is the shape, not the deployment. For a real one:

- **`AGENTBE_HTTP_HOST=0.0.0.0`** in a container. The default is loopback, and a
  published port would otherwise accept nothing. This example binds loopback
  deliberately, since everything runs on one host.
- **`AGENTBE_PRINCIPALS`** — a JSON map of bearer token → principal id. Gives
  per-person attribution *and* per-person revocation (delete one entry rather
  than rotating a shared secret across the whole org). The older single
  `AGENTBE_AUTH_TOKEN` authenticates but identifies nobody; commits land as
  `anonymous`.
- **`AGENTBE_S3_BUCKET`** (plus `AGENTBE_S3_PREFIX`, `AGENTBE_S3_REGION`, and
  optionally `AGENTBE_S3_ENDPOINT` for MinIO/R2) to run on S3. Credentials fall
  back to the default AWS provider chain — instance role, IRSA, env — so you
  normally set no keys. Without this the room runs on local disk and cannot be
  rescheduled to another node.
- **`AGENTBE_VECTOR=pg`** so the index persists. This example uses the hashing
  embedder and an in-memory index to stay fast; with a real embedder, every
  restart re-embeds the whole corpus without a persistent store.
- **TLS is not handled** by the room — terminate at a reverse proxy or load
  balancer.
- Token provisioning and room creation are **manual**. Fine at ten orgs, painful
  at a hundred — that's when room membership (§5.5) earns its keep.
