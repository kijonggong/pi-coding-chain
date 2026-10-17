#!/usr/bin/env node
/**
 * Refresh `aaii-scores.json` from the keyless EvalEval mirror.
 *
 * Why a script and not a plugin fetch: the official Artificial Analysis API
 * (https://artificialanalysis.ai/api/v2/language/models/free) needs an x-api-key
 * that this repository does not hold, so the mirror is the only source that
 * works unattended here. The mirror is MIT-licensed but rebuilds records from a
 * legacy AA endpoint that AA retires on 2026-11-04, so treat it as a bootstrap
 * and move to the official API once a key exists.
 *
 * The records carry `attribution_required: "true"`, so anything that surfaces
 * these numbers must credit Artificial Analysis.
 *
 * `scores` is regenerated; `aliases` and `aliasNotes` are carried forward from the
 * existing file. The alias map is the one field an operator writes by hand, and a
 * model the index does not cover has no other route to a rank, so a refresh that
 * reset it would quietly demote that model to the back of its chain.
 *
 * Usage:
 *   node fetch-scores.mjs                 # refresh the snapshot beside this file
 *   node fetch-scores.mjs --dry           # print what would be written
 *   node fetch-scores.mjs --out other.json
 *
 * Method: each model folder holds one record per cron run, and the file names are
 * opaque ids with no ordering, so the script samples a bounded number of files
 * per model and keeps the run with the newest `retrieved_timestamp`. The score
 * read is `evaluation_results[].score_details.score` for
 * `artificial_analysis.artificial_analysis_intelligence_index`.
 */

import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { aliasMapsFromSnapshot } from "./scores.ts";

const DATASET = "evaleval/EEE_datastore";
const PREFIX = "data/artificial-analysis-llms";
const API = "https://huggingface.co";
const INDEX_ID = "artificial_analysis.artificial_analysis_intelligence_index";

/** Files sampled per model. Records are per-run, so a few is enough to find a recent value. */
const SAMPLE = 4;

/** Router model key -> its Artificial Analysis creator folder and slug. */
const TARGETS = [
  { key: "muse-spark-open", creator: "meta", slug: "muse-spark-open" },
  {
    key: "deepseek-v4.1-flash-uncensored",
    creator: null,
    slug: null,
    note: "no AA entry; uncensored fine-tune of deepseek-v4.1-flash",
  },
  { key: "qwen3.8-flash-next-uncensored", creator: null, slug: null, note: "no AA entry; uncensored fine-tune" },
  { key: "qwen3.8-flash-next", creator: "alibaba", slug: "qwen3-8-flash-next" },
  { key: "qwen3.8-flash-next-iq3_s", creator: null, slug: null, note: "no AA entry; local quant" },
  { key: "z-ai/glm-5.3-flash", creator: "zai", slug: "glm-5-3-flash" },
  { key: "glm-5.2", creator: "zai", slug: "glm-5-2" },
  { key: "glm-5.1", creator: "zai", slug: "glm-5-1" },
  { key: "deepseek-v4.1-flash", creator: "deepseek", slug: "deepseek-v4-1-flash" },
  { key: "qwen3.8-max", creator: "alibaba", slug: "qwen3-8-max" },
  { key: "qwen3.8-max-0902", creator: "alibaba", slug: "qwen3-8-max-0902", fallback: "qwen3-8-max" },
  { key: "kimi-k3", creator: "kimi", slug: "kimi-k3" },
  { key: "kimi-k2.7-code", creator: "kimi", slug: "kimi-k2-7-code" },
  { key: "qwen3.5-27b", creator: "alibaba", slug: "qwen3-5-27b" },
  { key: "qwen3.5-35b-a3b", creator: "alibaba", slug: "qwen3-5-35b-a3b" },
  { key: "qwen3.5-122b-a10b", creator: "alibaba", slug: "qwen3-5-122b-a10b" },
  { key: "qwen3.5-397b-a17b", creator: "alibaba", slug: "qwen3-5-397b-a17b" },
  { key: "qwen3.5-omni-plus", creator: "alibaba", slug: "qwen3-5-omni-plus" },
  { key: "qwen3.6-27b", creator: "alibaba", slug: "qwen3-6-27b" },
  { key: "qwen3.6-plus", creator: "alibaba", slug: "qwen3-6-plus" },
  { key: "qwen3.6-max-preview", creator: "alibaba", slug: "qwen3-6-max-preview", fallback: "qwen3-6-max" },
  { key: "qwen3.7-plus", creator: "alibaba", slug: "qwen3-7-plus" },
  { key: "qwen3.7-max", creator: "alibaba", slug: "qwen3-7-max" },
  { key: "qwen3.5-flash", creator: null, slug: null, note: "no AA entry" },
  { key: "qwen3.5-plus", creator: null, slug: null, note: "no AA entry" },
  { key: "qwen3.6-flash", creator: null, slug: null, note: "no AA entry" },
  { key: "qwen3.7-flash", creator: null, slug: null, note: "no AA entry" },
];

async function getJson(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) {
    const error = new Error(`${response.status} ${response.statusText}`);
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function listFiles(creator, slug) {
  const url = `${API}/api/datasets/${DATASET}/tree/main/${PREFIX}/${creator}/${slug}`;
  const entries = await getJson(url);
  return entries.filter((entry) => entry.type === "file" && entry.path.endsWith(".json")).map((entry) => entry.path);
}

function pickIndex(result) {
  return (result.evaluation_results ?? []).find((entry) => entry.evaluation_result_id === INDEX_ID);
}

async function readRecord(path) {
  const record = await getJson(`${API}/datasets/${DATASET}/raw/main/${path}`);
  const index = pickIndex(record);
  const score = index?.score_details?.score;
  if (typeof score !== "number") return null;
  return {
    score,
    variant: record.model_info?.name ?? null,
    retrieved: typeof record.retrieved_timestamp === "number" ? new Date(record.retrieved_timestamp * 1000).toISOString().slice(0, 10) : null,
    url: `${API}/datasets/${DATASET}/raw/main/${path}`,
  };
}

async function resolve(target) {
  if (!target.creator || !target.slug) {
    return { slug: null, score: null, variant: null, sourceUrl: null, cronRunDate: null, note: target.note };
  }

  for (const slug of [target.slug, target.fallback].filter(Boolean)) {
    let files;
    try {
      files = await listFiles(target.creator, slug);
    } catch (error) {
      if (error.status === 404) continue;
      throw error;
    }
    if (files.length === 0) continue;

    const sample = [...files].sort().slice(0, SAMPLE);
    const records = [];
    for (const file of sample) {
      const record = await readRecord(file).catch(() => null);
      if (record) records.push(record);
    }
    if (records.length === 0) continue;

    const best = records.sort((a, b) => String(b.retrieved).localeCompare(String(a.retrieved)))[0];
    return {
      slug,
      score: best.score,
      variant: best.variant,
      sourceUrl: best.url,
      cronRunDate: best.retrieved,
      note: slug === target.slug ? undefined : `resolved via fallback slug ${slug}`,
    };
  }

  return { slug: null, score: null, variant: null, sourceUrl: null, cronRunDate: null, note: target.note ?? "no mirror folder" };
}

async function main() {
  const argv = process.argv.slice(2);
  const dry = argv.includes("--dry");
  const outIndex = argv.indexOf("--out");
  const outPath = outIndex >= 0 ? argv[outIndex + 1] : join(dirname(fileURLToPath(import.meta.url)), "aaii-scores.json");

  const scores = {};
  let resolved = 0;
  for (const target of TARGETS) {
    const result = await resolve(target).catch((error) => ({
      slug: null,
      score: null,
      variant: null,
      sourceUrl: null,
      cronRunDate: null,
      note: `error: ${error.message}`,
    }));
    scores[target.key] = {
      slug: result.slug,
      score: result.score,
      variant: result.variant,
      sourceUrl: result.sourceUrl,
      cronRunDate: result.cronRunDate,
      ...(result.note ? { note: result.note } : {}),
    };
    if (typeof result.score === "number") resolved++;
    const shown = typeof result.score === "number" ? String(result.score) : `-- ${result.note ?? ""}`;
    console.log(`  ${target.key.padEnd(34)} ${shown}`);
  }

  // `scores` is regenerated from the index, but `aliases` is the one part of this
  // file an operator writes by hand. Starting it from `{}` would silently erase a
  // model's only route to a rank, so the previous map is carried forward.
  const previousText = await readFile(outPath, "utf8").catch(() => "");
  const { aliases, aliasNotes } = aliasMapsFromSnapshot(previousText);
  if (Object.keys(aliases).length > 0) {
    console.log(`carrying forward ${Object.keys(aliases).length} alias(es) from ${outPath}`);
  }

  const snapshot = {
    attribution:
      "Artificial Analysis Intelligence Index (https://artificialanalysis.ai). Attribution is required wherever these scores surface; the free API tier is licensed for internal use without redistribution.",
    indexVersion: "4.3.x",
    retrieved: new Date().toISOString().slice(0, 10),
    sources: {
      mirror: `${API}/datasets/${DATASET}, path ${PREFIX}/<creator>/<model>/<uuid>.json (MIT dataset, keyless). Rebuilt from a legacy AA endpoint that retires 2026-11-04.`,
      api: "https://artificialanalysis.ai/api/v2/language/models/free with an x-api-key header (free tier: 100 requests / 24h). Preferred once a key exists.",
    },
    scoreKeyFormat:
      "Lowercased last path segment of litellm_params.model, with . and _ folded to -. The loader applies the same normalisation.",
    scores,
    aliases,
    aliasNotes,
  };

  if (dry) {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  await writeFile(outPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log(`\nresolved ${resolved}/${TARGETS.length} scores -> ${outPath}`);
}

await main();
