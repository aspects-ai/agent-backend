// Drives the demo room over a REAL stdio MCP connection — the same transport
// Claude Code uses — to prove the real retrieval path end to end: MiniLM text +
// CLIP image embeddings → search/exec over MCP.
//
// This is a manual smoke check, deliberately NOT part of the vitest suite (which
// stays fast/deterministic on the hashing embedder). It spins up its own room
// via run.sh, so it needs the built bin (and Docker only with --pg).
//
//   node examples/demo-room/smoke.mjs           # in-memory index (no Docker)
//   node examples/demo-room/smoke.mjs --pg       # persistent pgvector index
//   node examples/demo-room/smoke.mjs --reset    # wipe + re-seed first
import { fileURLToPath } from "node:url";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const runSh = path.join(here, "run.sh");
// Forward the same launch flags to run.sh so the smoke check can exercise either
// the in-memory (default) or the persistent pgvector path.
const runFlags = process.argv.slice(2).filter((a) => ["--pg", "--reset"].includes(a));

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

const transport = new StdioClientTransport({
  command: "bash",
  args: [runSh, ...runFlags],
  env: { ...process.env },
  stderr: "inherit",
});
const client = new Client({ name: "demo-room-smoke", version: "0.0.0" });

let failures = 0;
await client.connect(transport);
try {
  const { tools } = await client.listTools();
  console.log(`\nconnected — ${tools.length} tools: ${tools.map((t) => t.name).join(", ")}\n`);

  console.log("== semantic text retrieval (real MiniLM embeddings) ==");
  for (const { q, expect } of QUERIES) {
    const res = await client.callTool({
      name: "search",
      arguments: { query: q, k: 3, modality: "text" },
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
      arguments: { query: q, k: 3, modality: "image" },
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

  console.log("\n== sandboxed analysis (run_command over a search hit) ==");
  const exec = await client.callTool({
    name: "run_command",
    arguments: {
      command: "wc -l < data/ag_exports.csv",
      paths: ["data/ag_exports.csv"],
    },
  });
  const rows = textOf(exec).trim();
  console.log(`✓ counted rows in ag_exports.csv: ${rows}`);
} finally {
  await client.close();
}

console.log(failures === 0 ? "\nALL CHECKS PASSED\n" : `\n${failures} CHECK(S) FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
