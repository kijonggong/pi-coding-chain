/**
 * Tests for the AAII snapshot's alias map.
 *
 * Run with:
 *   node --test extensions/coding-fallback/scores.test.ts
 *
 * An alias is the only part of the snapshot an operator writes by hand, and it is
 * the only route to a rank for a model the index does not cover. Two things are
 * therefore worth pinning: that the lookup follows it, and that a refresh of the
 * snapshot cannot erase it.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { CODING_CHAIN, orderChain, readModelEntries } from "./chain.ts";
import { aliasMapsFromSnapshot, parseScores, scoreFor, unscoredModels } from "./scores.ts";
import type { ScoreSnapshot } from "./scores.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const LIVE_SNAPSHOT = join(HERE, "aaii-scores.json");

const SNAPSHOT = parseScores(
  JSON.stringify({
    attribution: "fixture",
    scores: {
      "base-model": { slug: "base-model", score: 39.8, variant: "reasoning" },
      "other-model": { slug: "other-model", score: 12, variant: "reasoning" },
      "no-entry": { slug: null, score: null, variant: null, note: "no AA entry" },
    },
    aliases: { "fine-tune": "base-model" },
    aliasNotes: { "fine-tune": "operator decision" },
  }),
) as ScoreSnapshot;

test("an alias resolves a model the index does not cover", () => {
  assert.equal(scoreFor(SNAPSHOT, "fine-tune"), 39.8);
  assert.equal(scoreFor(SNAPSHOT, "base-model"), 39.8);
  assert.equal(scoreFor(SNAPSHOT, "other-model"), 12);
});

test("a model with neither an entry nor an alias is unscored, not zero", () => {
  assert.equal(scoreFor(SNAPSHOT, "unheard-of"), undefined);
  assert.equal(scoreFor(SNAPSHOT, "no-entry"), undefined, "a null score is unscored");
  assert.deepEqual(unscoredModels(SNAPSHOT, ["fine-tune", "unheard-of", "base-model"]), ["unheard-of"]);
});

test("an alias key is normalised the same way as a model id", () => {
  // 'fine.tune' and 'FINE_TUNE' must hit the same alias as 'fine-tune'.
  assert.equal(scoreFor(SNAPSHOT, "fine.tune"), 39.8);
  assert.equal(scoreFor(SNAPSHOT, "FINE_TUNE"), 39.8);
});

test("aliasMapsFromSnapshot reads both maps and survives a bad file", () => {
  assert.deepEqual(aliasMapsFromSnapshot(JSON.stringify({ aliases: { a: "b" }, aliasNotes: { a: "why" } })), {
    aliases: { a: "b" },
    aliasNotes: { a: "why" },
  });
  assert.deepEqual(aliasMapsFromSnapshot("not json at all"), { aliases: {}, aliasNotes: {} });
  assert.deepEqual(aliasMapsFromSnapshot("[]"), { aliases: {}, aliasNotes: {} });
  assert.deepEqual(aliasMapsFromSnapshot(JSON.stringify({ aliases: { a: 7, b: "ok" } })), {
    aliases: { b: "ok" },
    aliasNotes: {},
  });
});

test("a refresh carries the operator's aliases forward instead of resetting them", async () => {
  const text = await readFile(LIVE_SNAPSHOT, "utf8");
  const carried = aliasMapsFromSnapshot(text);
  assert.ok(
    Object.keys(carried.aliases).length > 0,
    "the live snapshot records at least one operator alias; a refresh must not erase it",
  );
});

test("the live snapshot ranks the uncensored fine-tune off its base model", async () => {
  const live = parseScores(await readFile(LIVE_SNAPSHOT, "utf8")) as ScoreSnapshot;
  const inherited = scoreFor(live, "qwen3.8-flash-next-uncensored");
  const base = scoreFor(live, "qwen3.8-flash-next");

  assert.notEqual(base, undefined, "the base model must carry a score");
  assert.equal(inherited, base, "the fine-tune inherits the base model's score");
  assert.equal(aliasMapsFromSnapshot(await readFile(LIVE_SNAPSHOT, "utf8")).aliasNotes["qwen3.8-flash-next-uncensored"]?.length > 0, true, "the decision is recorded with a reason");
});

test("an aliased model is ranked by the inherited score, not left at the back", () => {
  const config = [
    "model_list:",
    "- model_name: code-7-explabs-fine-tune",
    "  litellm_params:",
    "    model: openai/fine-tune",
    "    api_base: https://api.experientiallabs.ai/v1",
    "- model_name: code-2-cline-other",
    "  litellm_params:",
    "    model: openai/other-model",
    "    api_base: http://127.0.0.1:28180/v1",
    "- model_name: ds-qwen3.5-27b",
    "  litellm_params:",
    "    model: openai/base-model",
    "    api_base: https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    "",
  ].join("\n");
  const entries = readModelEntries(config.split("\n"));

  const withAlias = orderChain(entries, CODING_CHAIN, SNAPSHOT).map((entry) => entry.name);
  assert.deepEqual(withAlias, ["code-7-explabs-fine-tune", "code-2-cline-other"], "39.8 ranks above 12");

  const withoutAlias = parseScores(
    JSON.stringify({ attribution: "fixture", scores: { "other-model": { score: 12 } }, aliases: {} }),
  ) as ScoreSnapshot;
  assert.deepEqual(
    orderChain(entries, CODING_CHAIN, withoutAlias).map((entry) => entry.name),
    ["code-2-cline-other", "code-7-explabs-fine-tune"],
    "drop the alias and the model goes back to the end of its chain",
  );
});
