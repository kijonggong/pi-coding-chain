import assert from "node:assert/strict";
import fs, { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { refreshFreeSnapshot } from "./free-fetch.ts";

test("refresh reports corrupt and directory snapshots even when no probe succeeds", async () => {
  const dir = await mkdtemp(join(tmpdir(), "free-refresh-"));
  try {
    const path = join(dir, "free.json");
    await writeFile(path, "{broken");
    const corrupt = await refreshFreeSnapshot({ path, targets: [] });
    assert.equal(corrupt.state, "error");
    assert.ok(corrupt.message.includes(`could not read previous snapshot ${path}: invalid free snapshot ${path}: malformed JSON or unusable snapshot`));
    assert.equal(await readFile(path, "utf8"), "{broken");
    const directory = await refreshFreeSnapshot({ path: dir, targets: [] });
    assert.ok(directory.message.includes(`could not read previous snapshot ${dir}: cannot read free snapshot ${dir}: `));
    assert.match(directory.message, /EISDIR/);
    const missing = await refreshFreeSnapshot({ path: join(dir, "missing.json"), targets: [] });
    assert.equal(missing.message, `no listing could be read (no probe target); the snapshot at ${join(dir, "missing.json")} is unchanged`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("refresh retains a permission diagnostic across error, dry-run and successful write results", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "free-permission-"));
  const path = join(dir, "free.json");
  const originalRead = fs.readFile;
  const read = t.mock.method(fs, "readFile", async (...args: Parameters<typeof fs.readFile>) => {
    if (args[0] === path) throw Object.assign(new Error("permission denied"), { code: "EACCES" });
    return originalRead(...args);
  });
  syncBuiltinESMExports();
  t.mock.method(globalThis, "fetch", async () => new Response('{"data":[]}', { status: 200 }));
  try {
    const diagnostic = `could not read previous snapshot ${path}: cannot read free snapshot ${path}: permission denied`;
    const error = await refreshFreeSnapshot({ path, targets: [] });
    assert.equal(error.state, "error");
    assert.ok(error.message.includes(diagnostic));
    const dry = await refreshFreeSnapshot({ path, env: { EXPLABS_API_KEY: "test" }, dryRun: true });
    assert.equal(dry.state, "written");
    assert.ok(dry.message.includes(diagnostic));
    const written = await refreshFreeSnapshot({ path, env: { EXPLABS_API_KEY: "test" } });
    assert.equal(written.state, "written");
    assert.ok(written.message.includes(diagnostic));
    const saved = JSON.parse(await originalRead(path, "utf8"));
    assert.equal(saved.providers[0].listed, 0);
    assert.deepEqual(saved.providers[0].free, []);
    const writeError = await refreshFreeSnapshot({ path: dir, env: { EXPLABS_API_KEY: "test" } });
    assert.equal(writeError.state, "error");
    assert.ok(writeError.message.startsWith(`cannot write ${dir} (`));
    assert.ok(writeError.message.includes(`could not read previous snapshot ${dir}: cannot read free snapshot ${dir}: `));
    assert.match(writeError.message, /EISDIR/);
  } finally {
    read.mock.restore();
    syncBuiltinESMExports();
    await rm(dir, { recursive: true, force: true });
  }
});
