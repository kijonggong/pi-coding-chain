/**
 * Tests for what the picker offers and what its keys mean.
 *
 * Run with:
 *   node --test extensions/coding-fallback/catalog.test.ts
 *
 * Pure rules only: candidate selection, ordering, mark resolution and the names a
 * batch claims. No file is read and no terminal is involved — the component that
 * draws this is `picker.ts`, and its own test is separate.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MARK_OFF,
  MARK_ON,
  candidatesFrom,
  claimNames,
  compareCandidates,
  describeBatch,
  knownUpstreams,
  pickerTitle,
  resolveSelection,
  servedUpstreams,
  sourceLine,
  toggleMarked,
} from "./catalog.ts";
import { parseScores } from "./scores.ts";
import type { ScoreSnapshot } from "./scores.ts";

const SCORES = parseScores(
  JSON.stringify({
    attribution: "fixture",
    scores: {
      "deepseek-v4-1-flash": { slug: "deepseek-v4-1-flash", score: 39.5 },
      "glm-5-3-flash": { slug: "glm-5-3-flash", score: 41.8 },
    },
    aliases: {},
  }),
) as ScoreSnapshot;

const CONFIG = [
  "model_list:",
  "- model_name: code-4-explabs-glm-5.3-flash",
  "  litellm_params:",
  "    model: openai/glm-5.3-flash",
  "    api_base: https://api.experientiallabs.ai/v1",
  "    api_key: os.environ/EXPLABS_API_KEY",
  "- model_name: code-2-nvidia-deepseek-v4.1-flash",
  "  litellm_params:",
  "    model: openai/deepseek-v4.1-flash",
  "    api_base: https://integrate.api.nvidia.com/v1",
  "    api_key: os.environ/NVIDIA_API_KEY",
  "- model_name: ds-qwen3.5-27b",
  "  litellm_params:",
  "    model: openai/qwen3.5-27b",
  "    api_base: https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  "router_settings:",
  "  model_group_alias:",
  "    coding-fallback: stale",
  "  fallbacks:",
  "  - stale:",
  "    - stale",
  "",
].join("\n");

const NVIDIA = "integrate.api.nvidia.com";
const EXPLABS = "api.experientiallabs.ai";

test("what a host already serves is read per host", () => {
  const served = servedUpstreams(CONFIG, NVIDIA);
  assert.equal(served.has("integrate.api.nvidia.com|deepseek-v4-1-flash"), true);
  assert.equal(
    served.has("integrate.api.nvidia.com|glm-5-3-flash"),
    false,
    "the same model on another host is not this host's",
  );
  assert.equal(servedUpstreams(CONFIG, EXPLABS).has("api.experientiallabs.ai|glm-5-3-flash"), true);
  assert.equal(servedUpstreams(CONFIG, "relay.example.invalid").size, 0);
});

test("the models this config uses elsewhere are the fallback list", () => {
  assert.deepEqual(knownUpstreams(CONFIG, NVIDIA), ["glm-5.3-flash", "qwen3.5-27b"]);
  assert.deepEqual(knownUpstreams(CONFIG, EXPLABS), ["deepseek-v4.1-flash", "qwen3.5-27b"]);
  assert.deepEqual(knownUpstreams(CONFIG, "relay.example.invalid"), ["deepseek-v4.1-flash", "glm-5.3-flash", "qwen3.5-27b"]);
});

test("candidates are what the host lists minus what it already serves", () => {
  const set = candidatesFrom(
    ["glm-5.3-flash", "deepseek-v4.1-flash", "qwen3.5-27b"],
    CONFIG,
    NVIDIA,
    SCORES,
  );

  assert.deepEqual(set.candidates, [
    { id: "glm-5.3-flash", score: 41.8 },
    { id: "qwen3.5-27b", score: undefined },
  ]);
  assert.equal(set.alreadyServed, 1, "the host's own model is counted, not offered");
});

test("a model on another host is still offered", () => {
  const set = candidatesFrom(["glm-5.3-flash"], CONFIG, NVIDIA, SCORES);
  assert.deepEqual(set.candidates.map((candidate) => candidate.id), ["glm-5.3-flash"]);
});

test("candidates are deduplicated and ordered by the score the chain uses", () => {
  const set = candidatesFrom(
    ["qwen3.5-27b", "glm-5.3-flash", "glm-5.3-flash", "  ", "zzz-unscored", "aaa-unscored"],
    CONFIG,
    NVIDIA,
    SCORES,
  );
  assert.deepEqual(set.candidates.map((candidate) => candidate.id), [
    "glm-5.3-flash",
    "aaa-unscored",
    "qwen3.5-27b",
    "zzz-unscored",
  ]);
});

test("a score is read through the same folding the chain uses", () => {
  // The table keys fold `.` to `-`, so `deepseek-v4.1-flash` resolves: the score
  // is the one the chain will actually order by.
  const set = candidatesFrom(["deepseek-v4.1-flash"], CONFIG, EXPLABS, SCORES);
  assert.deepEqual(set.candidates, [{ id: "deepseek-v4.1-flash", score: 39.5 }]);
});

test("candidate rows carry the mark and the rank", () => {
  assert.equal(`☑ glm-5.3-flash`, `${MARK_ON} glm-5.3-flash`);
  assert.equal(`☐ glm-5.3-flash`, `${MARK_OFF} glm-5.3-flash`);
  assert.equal(compareCandidates({ id: "a", score: 10 }, { id: "b", score: 20 }), 10);
  assert.equal(compareCandidates({ id: "a" }, { id: "b" }), -1);
});

test("marking is a set the caller owns, and unmarking works", () => {
  const empty = new Set<string>();
  const one = toggleMarked(empty, "a");
  assert.deepEqual([...one], ["a"]);
  assert.equal(empty.size, 0, "the old set is not mutated");

  const two = toggleMarked(one, "b");
  assert.deepEqual([...two].sort(), ["a", "b"]);
  assert.deepEqual([...toggleMarked(two, "a")], ["b"]);
});

test("enter means the marked rows, in the order the list shows them", () => {
  const order = ["c", "a", "b"];
  assert.deepEqual(resolveSelection(new Set(["b", "a"]), "c", order), ["a", "b"]);
  assert.deepEqual(resolveSelection(new Set(["missing"]), "c", order), [], "a mark that is no longer offered is dropped");
  assert.deepEqual(resolveSelection(new Set(), "c", order), ["c"], "nothing marked: the row under the cursor");
  assert.deepEqual(resolveSelection(new Set(), undefined, order), []);
});

test("a batch claims one number per model, after the highest in use", () => {
  const taken = ["code-2-nvidia-a", "code-4-explabs-b"];
  assert.deepEqual(claimNames(2, taken, "nvidia", ["model-x", "model-y"]), [
    "code-5-nvidia-model-x",
    "code-6-nvidia-model-y",
  ]);
  assert.deepEqual(claimNames(1, [], "nvidia", ["model-x"]), ["code-1-nvidia-model-x"]);
  assert.deepEqual(claimNames(3, taken, "nvidia", ["model-x"]), ["code-5-nvidia-model-x"], "no id, no name");
});

test("two ids that render the same name do not claim it twice", () => {
  // `groupName` drops the path prefix, so these two ids are one name.
  assert.deepEqual(claimNames(2, [], "zai", ["z-ai/glm-5.3-flash", "glm-5.3-flash"]), [
    "code-1-zai-glm-5.3-flash",
    "code-2-zai-glm-5.3-flash",
  ]);
});

test("the title says which list is being shown", () => {
  const listing = pickerTitle(NVIDIA, { kind: "listing" }, 7, 2);
  assert.match(listing, /integrate\.api\.nvidia\.com lists 7 to add/);
  assert.match(listing, /\(2 already in model_list\)/);
  assert.doesNotMatch(pickerTitle(NVIDIA, { kind: "listing" }, 1, 0), /already in model_list/);

  const fallback = pickerTitle(NVIDIA, { kind: "config", reason: "401 unauthorized" }, 3, 0);
  assert.match(fallback, /could not be listed \(401 unauthorized\)/);
  assert.match(fallback, /models this config uses elsewhere/);
});

test("the source line is stated in the confirmation too", () => {
  assert.match(sourceLine(NVIDIA, { kind: "listing" }), /own \/models listing/);
  assert.match(sourceLine(NVIDIA, { kind: "config", reason: "timeout" }), /could not be listed \(timeout\)/);
});

test("the confirmation shows every entry of a small batch", () => {
  const option = {
    host: NVIDIA,
    baseUrl: "https://integrate.api.nvidia.com/v1",
    apiKey: "os.environ/NVIDIA_API_KEY",
    slug: "nvidia",
    tier: 1,
    tierLabel: "daily",
    groups: ["code-2-nvidia-deepseek-v4.1-flash"],
  };
  const picks = [
    { candidate: { id: "glm-5.3-flash", score: 41.8 }, name: "code-5-nvidia-glm-5.3-flash" },
    { candidate: { id: "qwen3.5-27b" }, name: "code-6-nvidia-qwen3.5-27b" },
  ];

  const text = describeBatch(picks, option, { kind: "listing" });
  assert.match(text, /^- model_name: code-5-nvidia-glm-5\.3-flash$/m);
  assert.match(text, /^- model_name: code-6-nvidia-qwen3\.5-27b$/m);
  assert.match(text, /AAII 41\.8/);
  assert.match(text, /no AAII score — it sorts after every scored model/);
  assert.match(text, /tier: +daily/);
  assert.match(text, /own \/models listing/);
});

test("a long batch is cut off rather than pasted in full", () => {
  const option = {
    host: NVIDIA,
    baseUrl: "https://integrate.api.nvidia.com/v1",
    slug: "nvidia",
    tier: 1,
    tierLabel: "daily",
    groups: [],
  };
  const picks = Array.from({ length: 9 }, (_unused, index) => ({
    candidate: { id: `model-${index}` },
    name: `code-${index + 1}-nvidia-model-${index}`,
  }));

  const text = describeBatch(picks, option, { kind: "listing" });
  assert.match(text, /… and 3 more/);
  assert.equal(text.includes("model-6"), false, "only the first six entries are drawn");
});
