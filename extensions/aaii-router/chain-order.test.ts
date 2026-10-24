import assert from "node:assert/strict";
import { test } from "node:test";
import type { Candidate } from "./candidates.ts";
import { applyChainSettings } from "./chain-order.ts";

const candidates: readonly Candidate[] = ["a", "b", "c", "d"].map((id, index) => ({
  label: `provider/${id}`, provider: "provider", id, score: 100 - index, tier: 0, supportsImages: false,
}));

test("pins lead in configured order, missing and repeated pins are ignored, and remaining score order survives", () => {
  const ordered = applyChainSettings(candidates, { pinnedModels: ["provider/c", "gone/model", "provider/a", "provider/b", "provider/c"], excludedModels: [] });
  assert.deepEqual(ordered.map((candidate) => candidate.id), ["c", "a", "b", "d"]);
  assert.deepEqual(ordered[0], { label: "provider/c", provider: "provider", id: "c", score: 98, tier: 0, supportsImages: false });
  assert.deepEqual(candidates.map((candidate) => candidate.id), ["a", "b", "c", "d"]);
});

test("model exclusions override pins and leave other models from the same provider eligible", () => {
  assert.deepEqual(applyChainSettings(candidates, { pinnedModels: ["provider/c"], excludedModels: ["provider/c", "provider/b"] }).map((candidate) => candidate.id), ["a", "d"]);
  assert.deepEqual(applyChainSettings(candidates, { pinnedModels: [], excludedModels: [] }), candidates);
  assert.deepEqual(applyChainSettings([], { pinnedModels: ["gone/model"], excludedModels: [] }), []);
});
