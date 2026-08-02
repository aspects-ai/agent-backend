// Drives the demo room over the REAL streamable-HTTP MCP transport — the same
// surface `make demo` serves and `.mcp.json` points Claude Code at — to prove
// the real retrieval path end to end: MiniLM text + CLIP image embeddings →
// search/exec over MCP, with warm sessions surviving across HTTP requests.
//
// This is a manual smoke check, deliberately NOT part of the vitest suite (which
// stays fast/deterministic on the hashing embedder). By default it spins up its
// own room via run.sh on its own port and store dir, so it never clobbers a
// `make demo` you already have running; point it at that one with --url.
//
//   node examples/demo-room/smoke.mjs                     # in-memory index (no Docker)
//   node examples/demo-room/smoke.mjs --pg                 # persistent pgvector index
//   node examples/demo-room/smoke.mjs --reset              # wipe + re-seed first
//   node examples/demo-room/smoke.mjs --url=http://localhost:8848/mcp   # use a running demo
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const runSh = path.join(here, "run.sh");

const argv = process.argv.slice(2);
const runFlags = argv.filter((a) => ["--pg", "--reset"].includes(a));
const urlArg = argv.find((a) => a.startsWith("--url="))?.slice("--url=".length);

// Own port + store dir so a concurrent `make demo` (8848, ./.data) is untouched.
const PORT = 8849;
const STORE_DIR = path.join(here, ".smoke-data");

function textOf(result) {
  return (result.content ?? []).map((c) => c.text ?? "").join("");
}

// Each query pairs a natural-language question with the doc we expect to top the
// text results — phrased with few shared keywords so lexical matching alone
// can't win. Targets are the shared app corpus in room/testdata.
const QUERIES = [
  { q: "why do teams stop using the product and cancel", expect: "research/customer-interviews-q1.md" },
  { q: "how much does the Globex consulting engagement bill per hour", expect: "contracts/globex-sow.md" },
  { q: "being able to undo changes and restore an earlier state of the room", expect: "notes/roadmap.md" },
];

let child;
if (!urlArg) {
  // Boot our own room over HTTP. Status streams to stderr; the first launch
  // downloads the MiniLM + CLIP models (cached afterwards).
  child = spawn("bash", [runSh, `--http=${PORT}`, ...runFlags], {
    env: { ...process.env, AGENTBE_STORE_DIR: STORE_DIR },
    stdio: ["ignore", "inherit", "inherit"],
  });
  child.on("exit", (code) => {
    if (code !== null && code !== 0) {
      console.error(`\nroom server exited early with code ${code}`);
      process.exit(1);
    }
  });
}

const url = new URL(urlArg ?? `http://127.0.0.1:${PORT}/mcp`);
const client = new Client({ name: "demo-room-smoke", version: "0.0.0" });

// Retry until the server is listening — model load makes boot time variable.
async function connectWithRetry(deadlineMs = 180_000) {
  const started = Date.now();
  for (;;) {
    try {
      await client.connect(new StreamableHTTPClientTransport(url));
      return;
    } catch (err) {
      if (Date.now() - started > deadlineMs) throw err;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

let failures = 0;
await connectWithRetry();
try {
  const { tools } = await client.listTools();
  console.log(
    `\nconnected over HTTP (${url.href}) — ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}\n`,
  );

  console.log("== semantic text retrieval (real MiniLM embeddings) ==");
  for (const { q, expect } of QUERIES) {
    const res = await client.callTool({
      name: "search",
      arguments: { query: q, limit: 3, modality: "text" },
    });
    const text = textOf(res);
    const top = text.split("\n").find((l) => l.trim())?.trim() ?? "(no hits)";
    const ok = top.startsWith(expect);
    if (!ok) failures++;
    console.log(`${ok ? "✓" : "✗"} "${q}"`);
    console.log(`    top: ${top}`);
    if (!ok) console.log(`    expected: ${expect}`);
  }

  console.log("\n== cross-modal retrieval (real CLIP text→image) ==");
  {
    const q = "the Python programming language logo";
    const res = await client.callTool({
      name: "search",
      arguments: { query: q, limit: 3, modality: "image" },
    });
    const text = textOf(res);
    const top = text.split("\n").find((l) => l.trim())?.trim() ?? "(no hits)";
    // logo.png is the Python logo; photo.jpg is an unrelated photograph.
    const ok = top.startsWith("assets/logo.png");
    if (!ok) failures++;
    console.log(`${ok ? "✓" : "✗"} "${q}"`);
    console.log(`    top: ${top}`);
    if (!ok) console.log(`    expected: assets/logo.png`);
  }

  console.log("\n== PDF ingestion (derived text is searchable) ==");
  {
    const list = await client.callTool({ name: "list_documents", arguments: {} });
    const docs = textOf(list);
    const ok = docs.includes("docs/sample.pdf") && docs.includes("docs/sample.pdf.txt");
    if (!ok) failures++;
    console.log(`${ok ? "✓" : "✗"} sample.pdf preserved + .pdf.txt sibling extracted`);
  }

  console.log("\n== sandboxed analysis (one-shot run_command over a search hit) ==");
  {
    const exec = await client.callTool({
      name: "run_command",
      arguments: {
        command: "wc -l < data/ag_exports.csv",
        paths: ["data/ag_exports.csv"],
      },
    });
    console.log(`✓ counted rows in ag_exports.csv: ${textOf(exec).trim()}`);
  }

  console.log("\n== warm session across separate HTTP requests (stateful transport) ==");
  {
    const opened = await client.callTool({ name: "open_session", arguments: {} });
    const { session } = JSON.parse(textOf(opened));
    // Each call is its own HTTP request; the sandbox is keyed by Mcp-Session-Id,
    // so state must survive between them — what a stateless server couldn't do.
    await client.callTool({
      name: "run_command",
      arguments: { session, command: "echo persisted-across-http > marker.txt" },
    });
    const back = await client.callTool({
      name: "run_command",
      arguments: { session, command: "cat marker.txt" },
    });
    const ok = textOf(back).includes("persisted-across-http");
    if (!ok) failures++;
    console.log(`${ok ? "✓" : "✗"} sandbox state survived across requests: ${textOf(back).trim()}`);
    await client.callTool({ name: "close_session", arguments: { session } });
  }
} finally {
  await client.close().catch(() => {});
  child?.kill();
}

console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
