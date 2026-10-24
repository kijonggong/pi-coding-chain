import assert from "node:assert/strict";
import { test } from "node:test";
import { PROVIDER, ROUTES, candidatesForRoute, matchesFamily } from "./routes.ts";
import type { Candidate } from "./candidates.ts";

function candidate(id: string): Candidate {
  return { label: `x/${id}`, provider: "x", id, score: undefined, tier: 0, supportsImages: false };
}

test("one virtual provider carries the full-chain route and the two family routes", () => {
  assert.equal(PROVIDER, "fallback");
  assert.deepEqual(
    ROUTES.map((route) => `${PROVIDER}/${route.id}`),
    ["fallback/aaii", "fallback/deepseek-v4.1-flash", "fallback/glm-5.3-flash"],
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

test("candidatesForRoute orders a family by the quota that replenishes soonest, then label", () => {
  const all = [
    { ...candidate("deepseek-v4.1-flash"), tier: 3 },
    { ...candidate("glm-5.3-flash"), tier: 0 },
    { ...candidate("deepseek-v4.1-flash-1017"), tier: 4 },
    { ...candidate("qwen3.8-max"), tier: 0 },
    { ...candidate("deepseek-v4.1-flash-fast"), tier: 1 },
  ];
  const aaii = ROUTES[0];
  const deepseek = ROUTES[1];
  const glm = ROUTES[2];
  // The full chain keeps the order it was given (score order, decided upstream).
  assert.deepEqual(candidatesForRoute(aaii, all).map((entry) => entry.id), [
    "deepseek-v4.1-flash",
    "glm-5.3-flash",
    "deepseek-v4.1-flash-1017",
    "qwen3.8-max",
    "deepseek-v4.1-flash-fast",
  ]);
  // The family re-orders by tier: daily before monthly before credit, then label.
  assert.deepEqual(candidatesForRoute(deepseek, all).map((entry) => entry.id), [
    "deepseek-v4.1-flash-fast",
    "deepseek-v4.1-flash",
    "deepseek-v4.1-flash-1017",
  ]);
  assert.deepEqual(candidatesForRoute(glm, all).map((entry) => entry.id), ["glm-5.3-flash"]);
});
