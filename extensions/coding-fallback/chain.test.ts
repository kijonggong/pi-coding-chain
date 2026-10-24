/**
 * Tests for the fallback chain composer.
 *
 * Run with:
 *   node --test extensions/coding-fallback/chain.test.ts
 *
 * Ordering tests use a synthetic score table, so they are independent of
 * whatever the live snapshot happens to contain. No real AAII score is invented
 * here: the fixture scores are made-up numbers attached to made-up models.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { CHAINS, CODING_CHAIN, DASH_SCOPE_CHAIN, composeCodingFallback, readModelEntries } from "./chain.ts";
import { TIER_CREDIT, TIER_DAILY, TIER_FREE, TIER_MONTHLY, TIER_UNKNOWN, TIER_WEEKLY, tierForHost } from "./providers.ts";
import { canonicalModelKey, parseScores } from "./scores.ts";
import type { ScoreSnapshot } from "./scores.ts";

/** Fixture scores. Made-up numbers on made-up models, not real AAII values. */
const FIXTURE_SCORES = parseScores(
  JSON.stringify({
    attribution: "fixture",
    retrieved: null,
    scores: {
      "model-x": { slug: "model-x", score: 40, variant: "reasoning", sourceUrl: null, cronRunDate: null },
      "model-y": { slug: "model-y", score: 30, variant: "reasoning", sourceUrl: null, cronRunDate: null },
      "model-z": { slug: "model-z", score: 50, variant: "reasoning", sourceUrl: null, cronRunDate: null },
    },
    aliases: {},
  }),
) as ScoreSnapshot;

const SYNTHETIC = [
  "model_list:",
  "- model_name: code-1-explabs",
  "  litellm_params:",
  "    model: openai/model-x",
  "    api_base: https://api.experientiallabs.ai/v1",
  "- model_name: code-2-nvidia",
  "  litellm_params:",
  "    model: openai/model-x",
  "    api_base: https://integrate.api.nvidia.com/v1",
  "- model_name: code-3-dashscope",
  "  litellm_params:",
  "    model: openai/model-y",
  "    api_base: https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  "- model_name: code-4-unknown",
  "  litellm_params:",
  "    model: openai/model-never-scored",
  "    api_base: https://integrate.api.nvidia.com/v1",
  "- model_name: ds-qwen3.5-27b",
  "  litellm_params:",
  "    model: openai/model-z",
  "    api_base: https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  "router_settings:",
  "  model_group_alias:",
  "    coding-fallback: stale",
  "  fallbacks:",
  "  - stale:",
  "    - stale",
  "  num_retries: 2",
  "general_settings:",
  "  store_model_in_db: false",
  "",
].join("\n");

/**
 * A full config in the shape the composer sees in practice: every model_list
 * entry, both generated blocks, and router_settings keys after `fallbacks`.
 * A fixture stands in for the live file, which is machine-specific and can be
 * mid-edit.
 */
const REALISTIC = [
  "model_list:",
  "- model_name: code-1-explabs",
  "  litellm_params:",
  "    model: openai/model-x",
  "    api_base: https://api.experientiallabs.ai/v1",
  "    api_key: os.environ/EXPERIENTIAL_API_KEY",
  "- model_name: code-2-nvidia",
  "  litellm_params:",
  "    model: openai/model-x",
  "    api_base: https://integrate.api.nvidia.com/v1",
  "    api_key: os.environ/NVIDIA_API_KEY",
  "- model_name: code-3-dashscope",
  "  litellm_params:",
  "    model: openai/model-y",
  "    api_base: https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  "    api_key: os.environ/DASHSCOPE_API_KEY",
  "- model_name: code-4-unknown",
  "  litellm_params:",
  "    model: openai/model-never-scored",
  "    api_base: https://integrate.api.nvidia.com/v1",
  "    api_key: os.environ/NVIDIA_API_KEY",
  "- model_name: ds-qwen3.5-27b",
  "  litellm_params:",
  "    model: openai/model-z",
  "    api_base: https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  "    api_key: os.environ/DASHSCOPE_API_KEY",
  "- model_name: ds-qwen3.5-35b",
  "  litellm_params:",
  "    model: openai/model-y",
  "    api_base: https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
  "    api_key: os.environ/DASHSCOPE_API_KEY",
  "router_settings:",
  "  model_group_alias:",
  "    coding-fallback: code-2-nvidia",
  "    dashscope-coding-fallback: ds-qwen3.5-27b",
  "    qwen-quota-fallback: ds-qwen3.5-27b",
  "  fallbacks:",
  "  - coding-fallback:",
  "    - code-1-explabs",
  "    - code-3-dashscope",
  "    - code-4-unknown",
  "  - dashscope-coding-fallback:",
  "    - ds-qwen3.5-27b",
  "    - ds-qwen3.5-35b",
  "  - qwen-quota-fallback:",
  "    - ds-qwen3.5-27b",
  "    - ds-qwen3.5-35b",
  "  num_retries: 2",
  "  timeout: 120",
  "  allowed_fails: 3",
  "  cooldown_time: 60",
  "general_settings:",
  "  store_model_in_db: false",
  "",
].join("\n");

/** Member names under `<alias>:` in the generated fallbacks block, in order. */
function generatedOrder(text: string, alias: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line === `  - ${alias}:`);
  assert.notEqual(start, -1, `no fallbacks entry for ${alias}`);
  const order: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const match = /^ {4}- (\S+)/.exec(lines[i]);
    if (!match) break;
    order.push(match[1]);
  }
  return order;
}

test("orders by AAII score first, then by the soonest-resetting quota tier", () => {
  const outcome = composeCodingFallback(SYNTHETIC, FIXTURE_SCORES);
  assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.reason);
  if (!outcome.ok) return;

  // 40s before the 30; within the 40s NVIDIA's daily tier beats ExpLabs' monthly.
  // The alias list is the chain minus its head, which model_group_alias names,
  // and the unscored model stays in the chain ranked last.
  assert.equal(outcome.chains[0].head, "code-2-nvidia");
  assert.deepEqual(generatedOrder(outcome.text, "coding-fallback"), [
    "code-1-explabs",
    "code-3-dashscope",
    "code-4-unknown",
  ]);
  assert.deepEqual(outcome.chains[0].unscored, ["code-4-unknown"]);
});

test("places unscored models after every scored model", () => {
  const outcome = composeCodingFallback(SYNTHETIC, FIXTURE_SCORES);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  const order = generatedOrder(outcome.text, "coding-fallback");
  assert.equal(order[order.length - 1], "code-4-unknown");
});

test("ranks every member of a chain exactly once", () => {
  const outcome = composeCodingFallback(SYNTHETIC, FIXTURE_SCORES);
  assert.equal(outcome.ok, true);
  if (!outcome.ok) return;

  const entries = readModelEntries(SYNTHETIC.split("\n"));
  const coding = entries.filter((entry) => CODING_CHAIN.matches(entry.name)).map((e) => e.name);
  const order = generatedOrder(outcome.text, "coding-fallback");
  assert.equal(new Set(order).size, order.length, "no duplicate targets");
  const tail = coding.filter((name) => name !== outcome.chains[0].head);
  assert.deepEqual([...order].sort(), [...tail].sort(), "every non-head member appears once");
});

test("maps each configured upstream host to its quota tier", () => {
  assert.equal(tierForHost("100.78.239.122"), TIER_FREE);
  assert.equal(tierForHost("127.0.0.1"), TIER_DAILY);
  assert.equal(tierForHost("integrate.api.nvidia.com"), TIER_DAILY);
  assert.equal(tierForHost("api.commandcode.ai"), TIER_WEEKLY);
  assert.equal(tierForHost("api.experientiallabs.ai"), TIER_MONTHLY);
  assert.equal(tierForHost("dashscope-intl.aliyuncs.com"), TIER_CREDIT);
  assert.equal(tierForHost("example.invalid"), TIER_UNKNOWN, "unknown hosts must not default to free");
});

test("tier order spends the soonest-resetting allowance first", () => {
  assert.ok(TIER_FREE < TIER_DAILY);
  assert.ok(TIER_DAILY < TIER_WEEKLY);
  assert.ok(TIER_WEEKLY < TIER_MONTHLY);
  assert.ok(TIER_MONTHLY < TIER_CREDIT);
  assert.ok(TIER_CREDIT < TIER_UNKNOWN);
});

test("folds dots and underscores so router and AA ids share a key", () => {
  assert.equal(canonicalModelKey("openai/deepseek-ai/deepseek-v4.1-flash"), "deepseek-v4-1-flash");
  assert.equal(canonicalModelKey("openai/cline-free/deepseek-v4.1-flash"), "deepseek-v4-1-flash");
  assert.equal(canonicalModelKey("openai/qwen3.8-flash-next-iq3_s"), "qwen3-8-flash-next-iq3-s");
  assert.equal(canonicalModelKey("openai/qwen3.8-flash-next-uncensored"), "qwen3-8-flash-next-uncensored");
});

test("follows an alias when a model has no score of its own", () => {
  const aliased = parseScores(
    JSON.stringify({
      scores: { "model-x": { score: 40 }, "model-y": { score: 30 } },
      aliases: { "model-unknown": "model-y" },
    }),
  ) as ScoreSnapshot;

  const body = SYNTHETIC.replace("model: openai/model-never-scored", "model: openai/model-unknown");
  const outcome = composeCodingFallback(body, aliased);
  assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.reason);
  if (!outcome.ok) return;

  assert.deepEqual(outcome.chains[0].unscored, [], "an aliased model counts as ranked");
  // The aliased 30 ties with the other 30, so NVIDIA's daily tier wins the tie
  // and DashScope's credit tier loses it.
  assert.equal(outcome.chains[0].head, "code-2-nvidia");
  assert.deepEqual(generatedOrder(outcome.text, "coding-fallback"), [
    "code-1-explabs",
    "code-4-unknown",
    "code-3-dashscope",
  ]);
});

test("an order change is reported against the whole chain, not its tail", () => {
  const first = composeCodingFallback(SYNTHETIC, FIXTURE_SCORES);
  assert.equal(first.ok, true, first.ok ? "" : first.reason);
  if (!first.ok) return;

  // The coding alias does not repeat its head, so the order on disk is the tail
  // alone. Comparing that against the full composed list would report a reorder
  // on every pass; comparing like with like means the first pass reports the
  // head moving and the second reports nothing.
  assert.deepEqual(first.reordered.map((change) => change.alias), ["coding-fallback"]);
  assert.deepEqual(first.reordered[0].after, [
    "code-2-nvidia",
    "code-1-explabs",
    "code-3-dashscope",
    "code-4-unknown",
  ]);

  const second = composeCodingFallback(first.text, FIXTURE_SCORES);
  assert.equal(second.ok, true, second.ok ? "" : second.reason);
  if (!second.ok) return;
  assert.equal(second.changed, false);
  assert.deepEqual(second.reordered, [], "a settled config reports no order change");
});

/** Invariants that hold for any config: the rewrite changes only the generated blocks. */
function assertOnlyGeneratedBlocksChanged(text: string, rewritten: string): void {
  const before = text.split(/\r?\n/);
  const after = rewritten.split(/\r?\n/);
  const prefix = before.indexOf("router_settings:");
  assert.notEqual(prefix, -1);
  assert.deepEqual(after.slice(0, prefix), before.slice(0, prefix), "model_list and header must not move");

  const tailMarker = "  num_retries:";
  const tailStart = before.findIndex((line) => line.startsWith(tailMarker));
  assert.notEqual(tailStart, -1, "fixture must have keys after fallbacks");
  const beforeTail = before.slice(tailStart);
  const afterTail = after.slice(after.findIndex((line) => line.startsWith(tailMarker)));
  assert.deepEqual(afterTail, beforeTail, "router_settings keys after fallbacks must not move");

  assert.deepEqual(
    after.slice(after.indexOf("router_settings:"), after.indexOf("router_settings:") + 1),
    ["router_settings:"],
    "the router_settings header itself is preserved",
  );
}

test("leaves everything outside the two generated blocks untouched", () => {
  const outcome = composeCodingFallback(REALISTIC, FIXTURE_SCORES);
  assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.reason);
  if (!outcome.ok) return;

  assertOnlyGeneratedBlocksChanged(REALISTIC, outcome.text);
});

/** Drop one `- model_name:` block, so a fixture can be built with a chain emptied. */
function withoutModel(text: string, name: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line === `- model_name: ${name}`);
  assert.notEqual(start, -1, `no entry named ${name}`);
  let end = start + 1;
  while (end < lines.length && !lines[end].startsWith("- model_name:") && !lines[end].startsWith("router_settings:")) {
    end += 1;
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
}

test("a chain with no member is left out rather than refused", () => {
  // A config trimmed down to one chain is still a config this module composes.
  const only = withoutModel(withoutModel(SYNTHETIC, "code-3-dashscope"), "ds-qwen3.5-27b");
  const outcome = composeCodingFallback(only, FIXTURE_SCORES);
  assert.equal(outcome.ok, true, outcome.ok ? "" : outcome.reason);
  if (!outcome.ok) return;

  assert.deepEqual(outcome.chains.map((chain) => chain.alias), ["coding-fallback"]);
  // The head is in the alias block; the fallback list below it starts at the
  // second member, which is what generatedOrder reads.
  assert.equal(outcome.chains[0].head, "code-2-nvidia");
  assert.equal(generatedOrder(outcome.text, "coding-fallback")[0], "code-1-explabs");
  assert.doesNotMatch(outcome.text, /dashscope-coding-fallback/);
  assert.doesNotMatch(outcome.text, /qwen-quota-fallback/);
  assert.doesNotMatch(outcome.text, /ds-qwen3.5-27b/);
});

test("refuses a config whose model_list belongs to no chain at all", () => {
  const outcome = composeCodingFallback(
    [
      "model_list:",
      "- model_name: other-1",
      "  litellm_params:",
      "    model: openai/other",
      "    api_base: https://example.invalid/v1",
      "router_settings:",
      "  model_group_alias:",
      "    coding-fallback: stale",
      "  fallbacks:",
      "  - stale:",
      "    - stale",
      "",
    ].join("\n"),
    FIXTURE_SCORES,
  );

  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.match(outcome.reason, /no model_list entries match/);
});

test("refuses a config whose generated blocks are missing", () => {
  const outcome = composeCodingFallback("model_list:\n- model_name: code-1-a\n", FIXTURE_SCORES);
  assert.equal(outcome.ok, false);
  if (outcome.ok) return;
  assert.match(outcome.reason, /model_group_alias/);
});

test("declares one spec per chain", () => {
  assert.equal(CHAINS.length, 2);
  assert.deepEqual(DASH_SCOPE_CHAIN.aliases, ["dashscope-coding-fallback", "qwen-quota-fallback"]);
  assert.deepEqual(CODING_CHAIN.aliases, ["coding-fallback"]);
});


test("chain host classification normalizes URL hosts and leaves invalid sources unclassified", () => {
  const entries = readModelEntries([
    "model_list:", "- model_name: code-1-a", "  litellm_params:",
    "    model: openai/model-x", "    api_base: HTTPS://INTEGRATE.API.NVIDIA.COM:8443/v1",
    "- model_name: code-2-b", "  litellm_params:",
    "    model: openai/model-y", "    api_base: broken",
  ]);
  assert.deepEqual(entries.map((entry) => entry.host), ["integrate.api.nvidia.com", ""]);
  assert.deepEqual(entries.map((entry) => tierForHost(entry.host)), [1, 99]);
});
