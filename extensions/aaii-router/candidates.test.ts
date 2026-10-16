/**
 * Tests for the AAII router's candidate selection.
 *
 * Run with:
 *   node --test extensions/aaii-router/candidates.test.ts
 *
 * The fixtures use made-up model names and made-up scores, so nothing here
 * depends on a real leaderboard value or on which providers this machine has.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { TIER_CREDIT, TIER_DAILY, TIER_FREE, TIER_MONTHLY, TIER_UNKNOWN, TIER_WEEKLY } from "../coding-fallback/providers.ts";
import { parseScores } from "../coding-fallback/scores.ts";
import type { ScoreSnapshot } from "../coding-fallback/scores.ts";
import {
  buildCandidates,
  candidateLabel,
  containsImage,
  eligibleModels,
  orderForRequest,
  unclassifiedCandidates,
  unscoredCandidates,
} from "./candidates.ts";
import type { PhysicalModel } from "./candidates.ts";
import { stepForward } from "./cooldown.ts";

const SCORES = parseScores(
  JSON.stringify({
    scores: {
      "alpha-model": { score: 50 },
      "beta-model": { score: 40 },
      "gamma-model": { score: 30 },
    },
    aliases: { "delta-model": "gamma-model" },
  }),
) as ScoreSnapshot;

const model = (provider: string, id: string, baseUrl: string, supportsImages = false): PhysicalModel => ({
  provider,
  id,
  baseUrl,
  supportsImages,
});

const FREE_HOST = "http://100.78.239.122:8080/v1";
const DAILY_HOST = "http://127.0.0.1:28180/v1";
const WEEKLY_HOST = "https://api.commandcode.ai/v1";
const MONTHLY_HOST = "https://api.experientiallabs.ai/v1";
const CREDIT_HOST = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
const PROXY_HOST = "http://127.0.0.1:4000/v1";
const UNKNOWN_HOST = "https://relay.example.invalid/v1";

test("orders candidates by score, then by the soonest-resetting tier", () => {
  // One model resold by two providers, as Pi represents it: distinct providers,
  // never the same provider and id twice (Pi keys a catalog entry by both).
  const candidates = buildCandidates(
    [
      model("p", "gamma-model", CREDIT_HOST), // 30, credit
      model("m", "beta-model", MONTHLY_HOST), // 40, monthly
      model("d", "beta-model", DAILY_HOST), // 40, daily
      model("c", "alpha-model", CREDIT_HOST), // 50, credit
    ],
    SCORES,
  );

  assert.deepEqual(candidates.map((candidate) => candidate.label), [
    "c/alpha-model",
    "d/beta-model",
    "m/beta-model",
    "p/gamma-model",
  ]);
  // Same score: the daily copy precedes the monthly one.
  assert.deepEqual(candidates.map((candidate) => candidate.tier), [
    TIER_CREDIT,
    TIER_DAILY,
    TIER_MONTHLY,
    TIER_CREDIT,
  ]);
});

test("places models with no score after every scored model", () => {
  const candidates = buildCandidates(
    [model("p", "mystery-model", FREE_HOST), model("p", "gamma-model", CREDIT_HOST)],
    SCORES,
  );
  assert.deepEqual(candidates.map((c) => c.id), ["gamma-model", "mystery-model"]);
  assert.deepEqual(unscoredCandidates(candidates).map((c) => c.id), ["mystery-model"]);
});

test("resolves an aliased model and reports it as ranked", () => {
  const candidates = buildCandidates([model("p", "delta-model", FREE_HOST)], SCORES);
  assert.equal(candidates[0].score, 30);
  assert.deepEqual(unscoredCandidates(candidates), []);
});

test("treats an unrecognised host as unclassified instead of free", () => {
  const candidates = buildCandidates([model("p", "alpha-model", UNKNOWN_HOST)], SCORES);
  assert.equal(candidates[0].tier, TIER_UNKNOWN);
  assert.deepEqual(unclassifiedCandidates(candidates).map((c) => c.id), ["alpha-model"]);
});

test("excludes models served through the LiteLLM proxy", () => {
  const all = [model("litellm", "coding-fallback", PROXY_HOST), model("p", "alpha-model", FREE_HOST)];
  assert.deepEqual(eligibleModels(all).map(candidateLabel), ["p/alpha-model"]);

  // An explicit origin list overrides the default.
  const kept = eligibleModels(all, { excludedOrigins: ["http://elsewhere.invalid"] });
  assert.equal(kept.length, 2);
});

test("excludes a provider the settings leave out, whatever the model", () => {
  const all = [model("openrouter", "alpha-model", FREE_HOST), model("p", "beta-model", DAILY_HOST)];
  assert.deepEqual(
    buildCandidates(all, SCORES, { excludedProviders: ["openrouter"] }).map(candidateLabel),
    ["p/beta-model"],
  );
  // An empty list excludes nothing, and the origin rule is untouched by it.
  assert.equal(buildCandidates(all, SCORES, { excludedProviders: [] }).length, 2);
  assert.equal(buildCandidates(all, SCORES, { excludedOrigins: ["http://elsewhere.invalid"] }).length, 2);
});

test("drops duplicate provider and id pairs", () => {
  // Pi keys a catalog entry by provider and id, so a repeat is the same entry.
  const candidates = buildCandidates(
    [model("p", "alpha-model", FREE_HOST), model("p", "alpha-model", FREE_HOST)],
    SCORES,
  );
  assert.equal(candidates.length, 1);
});

test("steps past the model that failed", () => {
  const candidates = buildCandidates(
    [
      model("a", "alpha-model", FREE_HOST),
      model("b", "beta-model", DAILY_HOST),
      model("c", "gamma-model", CREDIT_HOST),
    ],
    SCORES,
  );
  assert.deepEqual(candidates.map(candidateLabel), ["a/alpha-model", "b/beta-model", "c/gamma-model"]);

  const step = (from: string | undefined) => stepForward(candidates, undefined, from, 0)?.label;
  assert.equal(step("a/alpha-model"), "b/beta-model");
  assert.equal(step("b/beta-model"), "c/gamma-model");
  assert.equal(step("c/gamma-model"), undefined, "the last candidate has nowhere to go");
  assert.equal(step("unknown/model"), "a/alpha-model", "an unknown failure restarts");
  assert.equal(step(undefined), "a/alpha-model");
});

test("reports image support from the catalog, and orders for a request with an image", () => {
  const candidates = buildCandidates(
    [
      model("blind", "alpha-model", FREE_HOST), // 50, the best score
      model("seeing", "gamma-model", CREDIT_HOST, true), // 30, can see
      model("also-blind", "beta-model", DAILY_HOST),
    ],
    SCORES,
  );
  assert.deepEqual(
    candidates.map((candidate) => candidate.supportsImages),
    [false, false, true],
    "score order decides until a request needs images",
  );

  // A text-only request keeps the policy order untouched.
  assert.deepEqual(orderForRequest(candidates, false).map(candidateLabel), [
    "blind/alpha-model",
    "also-blind/beta-model",
    "seeing/gamma-model",
  ]);

  // With an image, the candidate that can see leads; the blind ones keep their
  // own relative order, so nothing is dropped and the chain is as long as it was.
  assert.deepEqual(orderForRequest(candidates, true).map(candidateLabel), [
    "seeing/gamma-model",
    "blind/alpha-model",
    "also-blind/beta-model",
  ]);
});

test("sees an image in any message, including one written as a string", () => {
  assert.equal(containsImage([{ content: "describe this" }]), false);
  assert.equal(containsImage([{ content: [{ type: "text", text: "describe this" }] }]), false);
  assert.equal(
    containsImage([
      { content: "and this" },
      { content: [{ type: "text", text: "look" }, { type: "image", data: "AA", mimeType: "image/png" }] },
    ]),
    true,
  );
  assert.equal(containsImage([]), false);
});

test("covers every tier the provider table declares", () => {
  const candidates = buildCandidates(
    [
      model("p", "alpha-model", FREE_HOST),
      model("p", "beta-model", WEEKLY_HOST),
      model("p", "gamma-model", DAILY_HOST),
    ],
    SCORES,
  );
  const tiers = candidates.map((candidate) => candidate.tier);
  assert.ok(tiers.includes(TIER_FREE));
  assert.ok(tiers.includes(TIER_DAILY));
  assert.ok(tiers.includes(TIER_WEEKLY));
  assert.ok(TIER_WEEKLY < TIER_MONTHLY && TIER_MONTHLY < TIER_CREDIT);
});
