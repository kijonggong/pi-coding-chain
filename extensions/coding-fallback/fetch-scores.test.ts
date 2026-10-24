import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";

// Only the external fetch boundary is replaced; the real CLI reads and writes files.
const FETCH_STUB = `
globalThis.fetch = async (url) => {
  if (url.includes("/tree/")) return { ok: true, json: async () => [
    { type: "file", path: "bad-record.json" }, { type: "file", path: "good-record.json" }
  ] };
  if (url.endsWith("bad-record.json")) throw new Error("fixture transport failure");
  return { ok: true, json: async () => ({
    retrieved_timestamp: 1700000000,
    evaluation_results: [{ evaluation_result_id: "artificial_analysis.artificial_analysis_intelligence_index", score_details: { score: 42 } }]
  }) };
};
`;

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), "fetch-scores-contract-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ["fetch-scores.mjs", "scores.ts"]) {
    await copyFile(new URL(name, import.meta.url), join(directory, name));
  }
  const stub = join(directory, "fetch-stub.mjs");
  await writeFile(stub, FETCH_STUB);
  const run = (path: string) => spawnSync(process.execPath, ["--import", pathToFileURL(stub).href,
    join(directory, "fetch-scores.mjs"), "--out", path], {
    cwd: tmpdir(), encoding: "utf8", env: { ...process.env, PI_OFFLINE: "1" },
  });
  return { directory, run, output: join(directory, "scores.json") };
}

test("refresh refuses corrupt or unreadable previous scores without replacing them", async (t) => {
  const f = await fixture(t);
  await writeFile(f.output, "{broken");
  const corrupt = f.run(f.output);
  assert.notEqual(corrupt.status, 0);
  assert.ok(corrupt.stderr.includes(f.output));
  assert.match(corrupt.stderr, /cannot preserve aliases/);
  assert.equal(await readFile(f.output, "utf8"), "{broken");
  const unreadable = f.run(f.directory);
  assert.notEqual(unreadable.status, 0);
  assert.ok(unreadable.stderr.includes(f.directory));
  assert.match(unreadable.stderr, /cannot preserve aliases/);
  assert.match(unreadable.stderr, /EISDIR/);
});

test("refresh accepts missing scores, preserves aliases, and reports each skipped record", async (t) => {
  const f = await fixture(t);
  const first = f.run(f.output);
  assert.equal(first.status, 0, first.stderr);
  assert.match(first.stderr, /skipping index record bad-record.json: fixture transport failure/);
  const created = JSON.parse(await readFile(f.output, "utf8"));
  assert.deepEqual(created.aliases, {});
  assert.equal(created.scores["qwen3.8-flash-next"].score, 42);
  await writeFile(f.output, '{"aliases":{"manual":"base"},"aliasNotes":{"manual":"operator choice"}}');
  const second = f.run(f.output);
  assert.equal(second.status, 0, second.stderr);
  const refreshed = JSON.parse(await readFile(f.output, "utf8"));
  assert.deepEqual(refreshed.aliases, { manual: "base" });
  assert.deepEqual(refreshed.aliasNotes, { manual: "operator choice" });
});
