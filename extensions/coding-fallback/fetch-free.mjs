#!/usr/bin/env node
/**
 * Refresh `free-models.json` from each upstream's own model listing.
 *
 * Why this is cached rather than read on demand: a free promo is transient. On
 * 2026-10-14 ExpLabs published `ling-3.1-flash` at $0 in and $0 out and had
 * withdrawn it from the listing twelve hours later, so a check that only reads
 * the endpoint when someone looks would miss the window entirely.
 *
 * Only a model whose `pricing` object is present with both meters at exactly zero
 * is recorded as free. A listing entry with no price at all is a locked stub — a
 * chat request against one answers `model_requires_purchase` — and is recorded as
 * excluded, because a missing price is a missing fact, not a zero one.
 *
 * Usage:
 *   node fetch-free.mjs                  # refresh the snapshot beside this file
 *   node fetch-free.mjs --dry            # print what would be written
 *   node fetch-free.mjs --force          # ignore the freshness window
 *   node fetch-free.mjs --out other.json
 *
 * Requires the upstream key in the environment, e.g. `EXPLABS_API_KEY`. A failed
 * or unauthenticated probe leaves the previous snapshot untouched.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ATTRIBUTION, refreshFreeSnapshot } from "./free-fetch.ts";
import { buildFreeSnapshot } from "./free-models.ts";

const argv = process.argv.slice(2);
const dry = argv.includes("--dry");
const force = argv.includes("--force");
const outIndex = argv.indexOf("--out");
const outPath =
  outIndex >= 0 ? argv[outIndex + 1] : join(dirname(fileURLToPath(import.meta.url)), "free-models.json");

const result = await refreshFreeSnapshot({ path: outPath, dryRun: dry, force });

for (const provider of result.providers) {
  console.log(`${provider.host} — ${provider.listed} listed, ${provider.free.length} free`);
  for (const model of provider.free) {
    console.log(`  free  ${model.id} (${model.contextWindow} ctx${model.tools ? ", tools" : ""})`);
  }
  for (const entry of provider.excluded) {
    console.log(`  skip  ${entry.id} (${entry.reason})`);
  }
}

if (dry && result.providers.length > 0) {
  const snapshot = buildFreeSnapshot(result.providers, new Date().toISOString(), ATTRIBUTION);
  console.log(`\n${JSON.stringify(snapshot, null, 2)}`);
}

console.log(`\n${result.message}`);
console.log(`${result.path}`);
process.exitCode = result.state === "error" ? 1 : 0;
