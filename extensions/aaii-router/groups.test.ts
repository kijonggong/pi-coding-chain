/**
 * Tests for the routing groups: the family matchers, the per-group candidate
 * lists, the entry validation, and the default seed.
 *
 * Run with:
 *   node --test extensions/aaii-router/groups.test.ts
 *
 * These are the contracts `routes.test.ts` held while the two family routes
 * were hardcoded, carried over to the settings-driven `GroupDefinition` —
 * plus the validation the settings file now needs.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_GROUPS, FULL_CHAIN, PROVIDER, candidatesForGroup, matchesFamily, parseGroup } from "./groups.ts";
import type { Candidate } from "./candidates.ts";

function candidate(id: string): Candidate {
  return { label: `x/${id}`, provider: "x", id, score: undefined, tier: 0, supportsImages: false };
}

test("one virtual provider carries the full chain and the two seeded family groups", () => {
  assert.equal(PROVIDER, "fallback");
  assert.deepEqual(
    [FULL_CHAIN, ...DEFAULT_GROUPS].map((group) => `${PROVIDER}/${group.id}`),
    ["fallback/aaii", "fallback/deepseek-v4.1-flash", "fallback/glm-5.3-flash"],
  );
  assert.equal(FULL_CHAIN.match, undefined, "the full chain matches every candidate");
  assert.deepEqual(
    DEFAULT_GROUPS.map((group) => group.match),
    ["deepseek-v4-1-flash", "glm-5-3-flash"],
  );
});

test("family membership is a dash-delimited token, on the canonical key", () => {
  const family = "deepseek-v4-1-flash";
  // Exact, dated snapshot, fine-tune, tier suffix, supplier prefix.
  for (const id of [
    "deepseek/deepseek-v4.1-flash",
    "deepseek-ai/deepseek-v4.1-flash-1017",
    "deepseek-v4.1-flash-uncensored",
    "opencode-zen/deepseek-v4.1-flash-free",
    "hive/deepseek-ai/deepseek-v4.1-flash-1017",
  ]) {
    assert.ok(matchesFamily(id, family), `${id} should match`);
  }
  // A different version or family does not.
  for (const id of ["deepseek/deepseek-v4-flash", "deepseek-v4.1", "glm-5.3-flash", "glm-5.35"]) {
    assert.ok(!matchesFamily(id, family), `${id} should not match`);
  }
});

test("the glm family admits flash variants but not other versions or the non-flash base", () => {
  const family = "glm-5-3-flash";
  for (const id of ["z-ai/glm-5.3-flash", "zai_glm-5.3-flash", "GLM-5.3-Flash-Trial", "glm-5.3-flash:free"]) {
    assert.ok(matchesFamily(id, family), `${id} should match`);
  }
  for (const id of ["glm-5.2", "glm-5.1", "glm-5.35", "GLM-5.3", "zaicoding_glm-5.3"]) {
    assert.ok(!matchesFamily(id, family), `${id} should not match`);
  }
});

test("candidatesForGroup orders a family by the quota that replenishes soonest, then label", () => {
  const all = [
    { ...candidate("deepseek-v4.1-flash"), tier: 3 },
    { ...candidate("glm-5.3-flash"), tier: 0 },
    { ...candidate("deepseek-v4.1-flash-1017"), tier: 4 },
    { ...candidate("qwen3.8-max"), tier: 0 },
    { ...candidate("deepseek-v4.1-flash-fast"), tier: 1 },
  ];
  const deepseek = DEFAULT_GROUPS[0];
  const glm = DEFAULT_GROUPS[1];
  // The full chain keeps the order it was given (score order, decided upstream).
  assert.deepEqual(candidatesForGroup(FULL_CHAIN, all).map((entry) => entry.id), [
    "deepseek-v4.1-flash",
    "glm-5.3-flash",
    "deepseek-v4.1-flash-1017",
    "qwen3.8-max",
    "deepseek-v4.1-flash-fast",
  ]);
  // The family re-orders by tier: daily before monthly before credit, then label.
  assert.deepEqual(candidatesForGroup(deepseek, all).map((entry) => entry.id), [
    "deepseek-v4.1-flash-fast",
    "deepseek-v4.1-flash",
    "deepseek-v4.1-flash-1017",
  ]);
  assert.deepEqual(candidatesForGroup(glm, all).map((entry) => entry.id), ["glm-5.3-flash"]);
});

test("parseGroup validates one entry, so a file's bad line is named rather than guessed", () => {
  assert.deepEqual(parseGroup({ id: "qwen", match: "qwen3-8-max" }).group, {
    id: "qwen",
    name: "qwen3-8-max fallback",
    match: "qwen3-8-max",
  });

  for (const [entry, reason] of [
    [{}, "missing id"],
    [{ id: "qwen" }, "missing match"],
    [{ id: "aaii", match: "glm-5-3-flash" }, 'the id "aaii" is reserved for the full chain'],
    [{ id: "bad id", match: "glm-5-3-flash" }, "id is not a model id"],
    [{ id: "glm", match: "GLM-5-3-Flash" }, "match is not canonical"],
    [{ id: "glm", match: "glm-5-3-flash", strategy: "smart" }, "strategy is not one of"],
    [{ id: "glm", match: "glm-5-3-flash", affinity: "strict" }, "affinity is not one of"],
  ] as const) {
    const parsed = parseGroup(entry);
    assert.equal(parsed.group, undefined, JSON.stringify(entry));
    assert.match(parsed.reason ?? "", new RegExp(reason));
  }

  // A group may name its own strategy and affinity.
  const full = parseGroup({ id: "glm", match: "glm-5-3-flash", name: "GLM", strategy: "rotate", affinity: "turn" });
  assert.deepEqual(full.group, {
    id: "glm",
    name: "GLM",
    match: "glm-5-3-flash",
    strategy: "rotate",
    affinity: "turn",
  });
});
