// Verifies a multi-room deploy behaves like separate tenants: a credential for
// one room must be useless against another, and no content may cross.
//
// Boots both rooms via run.sh, then asserts. Deliberately NOT in the vitest
// suite — it exercises real processes, real ports, and real containers.
//
//   node examples/multi-room/check.mjs --reset
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const runSh = path.join(here, "run.sh");
const runFlags = process.argv.slice(2).filter((a) => a === "--reset" || a === "--s3");
const withSandbox = !process.argv.includes("--no-sandbox");

const ACME = { name: "acme", port: 8861, token: "tok-acme-ada", principal: "ada@acme.com" };
const GLOBEX = { name: "globex", port: 8862, token: "tok-globex-bob", principal: "bob@globex.com" };

const textOf = (r) => (r.content ?? []).map((c) => c.text ?? "").join("");
let failures = 0;
function check(ok, label, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${label}${detail ? `\n    ${detail}` : ""}`);
}

const child = spawn("bash", [runSh, ...runFlags], { stdio: ["ignore", "inherit", "inherit"] });
child.on("exit", (code) => {
  if (code !== null && code !== 0) {
    console.error(`\nrooms exited early with code ${code}`);
    process.exit(1);
  }
});

async function connect(port, token, { deadlineMs = 120_000 } = {}) {
  const started = Date.now();
  for (;;) {
    try {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
        token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : undefined,
      );
      const client = new Client({ name: "multi-room-check", version: "0.0.0" });
      await client.connect(transport);
      return client;
    } catch (err) {
      // A rejected credential is an immediate answer, not a boot delay.
      if (String(err).includes("401") || String(err).includes("403")) throw err;
      if (Date.now() - started > deadlineMs) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

const open = [];
try {
  console.log("\n== each room accepts its own credential ==");
  const acme = await connect(ACME.port, ACME.token);
  const globex = await connect(GLOBEX.port, GLOBEX.token);
  open.push(acme, globex);
  check(true, "acme and globex both reachable with their own tokens");

  console.log("\n== a room's credential is useless against another room ==");
  for (const [from, to] of [
    [ACME, GLOBEX],
    [GLOBEX, ACME],
  ]) {
    let rejected = false;
    try {
      const c = await connect(to.port, from.token, { deadlineMs: 5_000 });
      open.push(c);
    } catch {
      rejected = true;
    }
    check(rejected, `${from.name}'s token rejected by ${to.name}`);
  }

  console.log("\n== no content crosses between rooms ==");
  const acmeDocs = textOf(await acme.callTool({ name: "list_documents", arguments: {} }));
  const globexDocs = textOf(await globex.callTool({ name: "list_documents", arguments: {} }));
  check(acmeDocs.includes("acme-secret.md"), "acme sees its own secret");
  check(!acmeDocs.includes("globex-secret.md"), "acme does NOT see globex's secret", acmeDocs.replace(/\n/g, " "));
  check(globexDocs.includes("globex-secret.md"), "globex sees its own secret");
  check(!globexDocs.includes("acme-secret.md"), "globex does NOT see acme's secret", globexDocs.replace(/\n/g, " "));

  // Same filename in both rooms must resolve to that room's content.
  const acmeNotes = textOf(await acme.callTool({ name: "read_document", arguments: { path: "notes.md" } }));
  const globexNotes = textOf(await globex.callTool({ name: "read_document", arguments: { path: "notes.md" } }));
  check(acmeNotes.includes("acme"), "shared filename resolves per-room (acme)");
  check(globexNotes.includes("globex"), "shared filename resolves per-room (globex)");
  check(acmeNotes !== globexNotes, "identical paths hold different content per room");

  console.log("\n== commits are attributed to the acting principal ==");
  const ref = textOf(
    await acme.callTool({
      name: "put_document",
      // A forged author must be ignored — the schema doesn't accept it.
      arguments: { path: "from-ada.md", content: "written by ada", author: "bob@globex.com" },
    }),
  );
  check(ref.startsWith("committed"), "acme principal committed", ref.trim());
  const afterAcme = textOf(await acme.callTool({ name: "list_documents", arguments: {} }));
  const afterGlobex = textOf(await globex.callTool({ name: "list_documents", arguments: {} }));
  check(afterAcme.includes("from-ada.md"), "new doc visible in acme");
  check(!afterGlobex.includes("from-ada.md"), "new doc NOT visible in globex");

  if (withSandbox) {
    console.log("\n== each room executes in its own sandbox ==");
    const a = await acme.callTool({
      name: "run_command",
      arguments: { command: "cat acme-secret.md 2>&1 | head -1; ls globex-secret.md 2>&1 | head -1" },
    });
    const out = textOf(a);
    check(out.includes("acme confidential"), "acme sandbox has acme content");
    check(!out.includes("globex confidential"), "acme sandbox has no globex content", out.replace(/\n/g, " "));
  }
} finally {
  await Promise.all(open.map((c) => c.close().catch(() => {})));
  child.kill();
}

console.log(failures === 0 ? "\nMULTI-ROOM CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
