// Verifies a Kubernetes multi-room deploy: rooms are isolated from each other,
// and each warm session gets its OWN sandbox pod (so concurrent sessions can't
// see each other's filesystem — the guarantee that running the room's local
// provider inside a shared room pod would silently lose).
//
// Assumes `rooms.yaml` is applied. Port-forwards both Services, then asserts.
//
//   node room/examples/k8s/check.mjs [--context kind-agentbe]
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const run = promisify(execFile);

const argv = process.argv.slice(2);
const CONTEXT = argv.find((a) => a.startsWith("--context="))?.split("=")[1] ?? "kind-agentbe";
const NS = "agentbe";

const ACME = { name: "acme", svc: "room-acme", port: 18861, token: "tok-acme-ada" };
const GLOBEX = { name: "globex", svc: "room-globex", port: 18862, token: "tok-globex-bob" };

const textOf = (r) => (r.content ?? []).map((c) => c.text ?? "").join("");
let failures = 0;
function check(ok, label, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? `\n    ${detail}` : ""}`);
}

// Every kubectl call names the context explicitly — never inherit the current
// one, which may well be a production cluster.
const kubectl = (args) => run("kubectl", ["--context", CONTEXT, "-n", NS, ...args]);

async function sandboxPods() {
  const { stdout } = await kubectl([
    "get", "pods", "-l", "agentbe.room/sandbox=true",
    "-o", "jsonpath={range .items[*]}{.metadata.name}{\"\\n\"}{end}",
  ]);
  return stdout.trim().split("\n").filter(Boolean);
}

const forwards = [];
function portForward(svc, port) {
  const p = spawn(
    "kubectl",
    ["--context", CONTEXT, "-n", NS, "port-forward", `svc/${svc}`, `${port}:8080`],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
  forwards.push(p);
}

async function connect(port, token, { deadlineMs = 90_000 } = {}) {
  const started = Date.now();
  for (;;) {
    try {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
        token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : undefined,
      );
      const client = new Client({ name: "k8s-check", version: "0.0.0" });
      await client.connect(transport);
      return client;
    } catch (err) {
      if (String(err).includes("401") || String(err).includes("403")) throw err;
      if (Date.now() - started > deadlineMs) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

portForward(ACME.svc, ACME.port);
portForward(GLOBEX.svc, GLOBEX.port);

const open = [];
try {
  console.log("\n== rooms reachable in-cluster ==");
  const acme = await connect(ACME.port, ACME.token);
  const globex = await connect(GLOBEX.port, GLOBEX.token);
  open.push(acme, globex);
  check(true, "both room Services reachable");

  console.log("\n== credentials do not cross rooms ==");
  let rejected = false;
  try {
    open.push(await connect(GLOBEX.port, ACME.token, { deadlineMs: 5_000 }));
  } catch {
    rejected = true;
  }
  check(rejected, "acme's token rejected by the globex room");

  console.log("\n== content does not cross rooms ==");
  const acmeDocs = textOf(await acme.callTool({ name: "list_documents", arguments: {} }));
  const globexDocs = textOf(await globex.callTool({ name: "list_documents", arguments: {} }));
  check(acmeDocs.includes("acme-secret.md"), "acme sees its own secret");
  check(!acmeDocs.includes("globex-secret.md"), "acme does NOT see globex's secret");
  check(globexDocs.includes("globex-secret.md"), "globex sees its own secret");

  console.log("\n== each session gets its own sandbox POD ==");
  const before = await sandboxPods();
  const s1 = JSON.parse(textOf(await acme.callTool({ name: "open_session", arguments: {} })));
  const s2 = JSON.parse(textOf(await acme.callTool({ name: "open_session", arguments: {} })));
  const during = await sandboxPods();
  check(
    during.length === before.length + 2,
    `two sessions created two sandbox pods (${before.length} → ${during.length})`,
    during.join(", "),
  );

  console.log("\n== concurrent sessions are isolated from each other ==");
  await acme.callTool({
    name: "run_command",
    arguments: { session: s1.session, command: "echo secret-from-s1 > private1.txt" },
  });
  await acme.callTool({
    name: "run_command",
    arguments: { session: s2.session, command: "echo secret-from-s2 > private2.txt" },
  });
  const peek = textOf(
    await acme.callTool({
      name: "run_command",
      arguments: { session: s1.session, command: "cat private2.txt 2>&1 || true" },
    }),
  );
  check(!peek.includes("secret-from-s2"), "session 1 cannot read session 2's file", peek.trim());
  const own = textOf(
    await acme.callTool({
      name: "run_command",
      arguments: { session: s1.session, command: "cat private1.txt" },
    }),
  );
  check(own.includes("secret-from-s1"), "session 1 still sees its own file");
  const h1 = textOf(await acme.callTool({ name: "run_command", arguments: { session: s1.session, command: "hostname" } })).trim();
  const h2 = textOf(await acme.callTool({ name: "run_command", arguments: { session: s2.session, command: "hostname" } })).trim();
  check(h1 !== h2, "sessions run on different pods", `${h1} vs ${h2}`);

  console.log("\n== commit-back from a sandbox pod ==");
  const ref = textOf(await acme.callTool({ name: "commit_session", arguments: { session: s1.session } }));
  check(ref.startsWith("committed"), "committed from the sandbox pod", ref.trim());
  const after = textOf(await acme.callTool({ name: "list_documents", arguments: {} }));
  check(after.includes("private1.txt"), "committed file is now part of the room");

  console.log("\n== closing a session deletes its pod ==");
  await acme.callTool({ name: "close_session", arguments: { session: s1.session } });
  await acme.callTool({ name: "close_session", arguments: { session: s2.session } });
  let remaining = [];
  for (let i = 0; i < 30; i++) {
    remaining = await sandboxPods();
    if (remaining.length === before.length) break;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  check(
    remaining.length === before.length,
    `sandbox pods cleaned up (${during.length} → ${remaining.length})`,
    remaining.join(", "),
  );
} finally {
  await Promise.all(open.map((c) => c.close().catch(() => {})));
  for (const f of forwards) f.kill();
}

console.log(failures === 0 ? "\nK8S CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
