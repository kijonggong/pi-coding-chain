/**
 * Tests for registering a model into the coding chain.
 *
 * Run with:
 *   node --test extensions/coding-fallback/register.test.ts
 *
 * Pure rules only: what the window offers, what it refuses, and the bytes it
 * writes. Nothing here reads or writes a file, and no fixture carries credential
 * material — the key lines are `os.environ/NAME` placeholders.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  SUBCOMMANDS,
  completionsFor,
  describeAddition,
  existingGroupNames,
  groupName,
  insertModelEntry,
  nextCodeNumber,
  optionForSlug,
  upstreamOptions,
  validateGroupName,
  validateModelId,
  validateSlug,
} from "./register.ts";
import { parseScores } from "./scores.ts";
import type { ScoreSnapshot } from "./scores.ts";

const SCORES = parseScores(
  JSON.stringify({
    attribution: "fixture",
    scores: { "deepseek-v4.1-flash": { slug: "deepseek-v4-1-flash", score: 39.5 } },
    aliases: {},
  }),
) as ScoreSnapshot;

const CONFIG = [
  "model_list:",
  "- model_name: code-2-nvidia-deepseek-v4.1-flash",
  "  litellm_params:",
  "    model: openai/deepseek-v4.1-flash",
  "    api_base: https://integrate.api.nvidia.com/v1",
  "    api_key: os.environ/NVIDIA_API_KEY",
  "- model_name: code-4-explabs-glm-5.3-flash",
  "  litellm_params:",
  "    model: openai/glm-5.3-flash",
  "    api_base: https://api.experientiallabs.ai/v1",
  "    api_key: os.environ/EXPLABS_API_KEY",
  "- model_name: code-7-qwen3.8-flash-next-iq3s",
  "  litellm_params:",
  "    model: openai/qwen3.8-flash-next-iq3s",
  "    api_base: https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
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
  "  num_retries: 2",
  "",
].join("\n");

/** The same config with a generated free group at the tail of `model_list`. */
const WITH_GENERATED = CONFIG.replace(
  "router_settings:",
  [
    "- model_name: code-free-explabs-ling-3.1-flash",
    "  litellm_params:",
    "    model: openai/ling-3.1-flash",
    "    api_base: https://api.experientiallabs.ai/v1",
    "    api_key: os.environ/EXPLABS_API_KEY",
    "router_settings:",
  ].join("\n"),
);

test("offers each upstream the config already has, in file order", () => {
  const options = upstreamOptions(CONFIG);

  assert.deepEqual(
    options.map((option) => option.host),
    ["integrate.api.nvidia.com", "api.experientiallabs.ai", "dashscope-intl.aliyuncs.com"],
  );
  assert.deepEqual(options[0], {
    host: "integrate.api.nvidia.com",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    apiKey: "os.environ/NVIDIA_API_KEY",
    slug: "nvidia",
    tier: 1,
    tierLabel: "daily",
    groups: ["code-2-nvidia-deepseek-v4.1-flash"],
  });
  assert.equal(options[1].slug, "explabs", "the slug is read from the host's own name");
  assert.equal(options[1].tierLabel, "monthly");
  assert.equal(options[2].apiKey, undefined, "a host with no key line offers none");
  assert.equal(options[2].tierLabel, "credit");
});

test("a host whose names carry no slug offers none, so the window asks", () => {
  // `code-7-qwen3.8-flash-next-iq3s` is the upstream id alone, and `ds-` names
  // are neither shape; guessing "dashscope-intl" from the hostname instead would
  // be an invented name in a file the operator has to read.
  const options = upstreamOptions(CONFIG);
  const dashscope = options.find((option) => option.host === "dashscope-intl.aliyuncs.com");
  assert.equal(dashscope?.slug, undefined);
  assert.equal(optionForSlug(options, "dashscope"), undefined);
  assert.equal(optionForSlug(options, "NVIDIA")?.host, "integrate.api.nvidia.com", "slug lookup ignores case");
});

test("a generated free group attests the slug of the host it serves", () => {
  const options = upstreamOptions(WITH_GENERATED);
  const explabs = options.find((option) => option.host === "api.experientiallabs.ai");
  assert.equal(explabs?.slug, "explabs");
  assert.deepEqual(explabs?.groups, [
    "code-4-explabs-glm-5.3-flash",
    "code-free-explabs-ling-3.1-flash",
  ]);
});

test("a host is offered once, however many groups it has", () => {
  const options = upstreamOptions(WITH_GENERATED);
  assert.equal(options.length, 3);
  assert.equal(options.filter((option) => option.host === "api.experientiallabs.ai").length, 1);
});

test("an entry with no api_base is not an upstream to register against", () => {
  const partial = ["model_list:", "- model_name: code-9-nowhere-model-x", "  litellm_params:", "    model: openai/model-x", "router_settings:"].join("\n");
  assert.deepEqual(upstreamOptions(partial), []);
});

test("the next number follows the highest one in use", () => {
  assert.equal(nextCodeNumber(existingGroupNames(CONFIG)), 8);
  assert.equal(nextCodeNumber([]), 1);
  assert.equal(
    nextCodeNumber(["code-free-explabs-ling-3.1-flash", "ds-qwen3.5-27b"]),
    1,
    "generated and DashScope names do not carry a hand-assigned number",
  );
});

test("the group name drops a path prefix and keeps the dots", () => {
  assert.equal(groupName(8, "nvidia", "deepseek-v4.1-flash"), "code-8-nvidia-deepseek-v4.1-flash");
  assert.equal(groupName(1, "zai", "z-ai/glm-5.3-flash"), "code-1-zai-glm-5.3-flash");
});

test("a model id is checked before it reaches the file", () => {
  assert.equal(validateModelId("deepseek-v4.1-flash"), undefined);
  assert.equal(validateModelId("z-ai/glm-5.3-flash"), undefined);
  assert.match(validateModelId("  ") ?? "", /required/);
  assert.match(validateModelId("has space") ?? "", /not a model id/);
  assert.match(validateModelId("#comment") ?? "", /not a model id/);
  assert.match(validateModelId("-leading") ?? "", /not a model id/);
  assert.match(validateModelId('quo"te') ?? "", /not a model id/);
});

test("a slug is lowercase and dash-separated", () => {
  assert.equal(validateSlug("nvidia"), undefined);
  assert.equal(validateSlug("my-upstream-2"), undefined);
  assert.match(validateSlug("NVIDIA") ?? "", /not a slug/);
  assert.match(validateSlug("-tail") ?? "", /not a slug/);
  assert.match(validateSlug("tail-") ?? "", /not a slug/);
  assert.match(validateSlug("") ?? "", /required/);
});

test("a group name has to be one the coding chain will pick up", () => {
  assert.equal(validateGroupName("code-8-nvidia-deepseek-v4.1-flash"), undefined);
  assert.match(validateGroupName("ds-qwen3.5-27b") ?? "", /not a coding-chain group name/);
  assert.match(validateGroupName("code-8-nvidia-model x") ?? "", /not a group name/);
  assert.match(validateGroupName("code-8-nvidia:model") ?? "", /not a group name/);
  assert.match(validateGroupName("code-free-explabs-ling-3.1-flash") ?? "", /snapshot owns/);
  assert.match(validateGroupName("  ") ?? "", /required/);
});

test("the entry goes in with the hand-written groups", () => {
  const inserted = insertModelEntry(WITH_GENERATED, {
    name: "code-8-nvidia-deepseek-v4.1-flash",
    modelId: "deepseek-v4.1-flash",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    apiKey: "os.environ/NVIDIA_API_KEY",
  });
  assert.ok(inserted.ok, inserted.ok ? "" : inserted.reason);

  const lines = inserted.text.split("\n");
  assert.deepEqual(lines.slice(lines.indexOf("- model_name: code-8-nvidia-deepseek-v4.1-flash"), lines.indexOf("- model_name: code-8-nvidia-deepseek-v4.1-flash") + 5), [
    "- model_name: code-8-nvidia-deepseek-v4.1-flash",
    "  litellm_params:",
    "    model: openai/deepseek-v4.1-flash",
    "    api_base: https://integrate.api.nvidia.com/v1",
    "    api_key: os.environ/NVIDIA_API_KEY",
  ]);
  assert.ok(
    lines.indexOf("- model_name: code-8-nvidia-deepseek-v4.1-flash") <
      lines.indexOf("- model_name: code-free-explabs-ling-3.1-flash"),
    "a new hand-written group is not filed among the generated ones",
  );
  assert.equal(
    lines.indexOf("router_settings:"),
    WITH_GENERATED.split("\n").indexOf("router_settings:") + 5,
    "the entry adds five lines and moves nothing else",
  );
});

test("without a generated group the entry lands at the end of model_list", () => {
  const inserted = insertModelEntry(CONFIG, {
    name: "code-8-nvidia-deepseek-v4.1-flash",
    modelId: "deepseek-v4.1-flash",
    baseUrl: "https://integrate.api.nvidia.com/v1",
  });
  assert.ok(inserted.ok, inserted.ok ? "" : inserted.reason);

  const lines = inserted.text.split("\n");
  const at = lines.indexOf("- model_name: code-8-nvidia-deepseek-v4.1-flash");
  assert.deepEqual(lines.slice(at, at + 5), [
    "- model_name: code-8-nvidia-deepseek-v4.1-flash",
    "  litellm_params:",
    "    model: openai/deepseek-v4.1-flash",
    "    api_base: https://integrate.api.nvidia.com/v1",
    "router_settings:",
  ]);
  assert.equal(lines.at(-1), "", "the file still ends with a newline");
  assert.ok(!inserted.text.includes("api_key: undefined"));
});

test("a CRLF config stays CRLF", () => {
  const inserted = insertModelEntry(CONFIG.replace(/\n/g, "\r\n"), {
    name: "code-8-nvidia-deepseek-v4.1-flash",
    modelId: "deepseek-v4.1-flash",
    baseUrl: "https://integrate.api.nvidia.com/v1",
  });
  assert.ok(inserted.ok, inserted.ok ? "" : inserted.reason);
  assert.ok(inserted.text.includes("- model_name: code-8-nvidia-deepseek-v4.1-flash\r\n"));
  assert.equal(inserted.text.includes("\n\n"), false, "no line is doubled");
});

test("refuses a name that is already there, and a config with no model_list", () => {
  const dupe = insertModelEntry(CONFIG, {
    name: "code-2-nvidia-deepseek-v4.1-flash",
    modelId: "deepseek-v4.1-flash",
    baseUrl: "https://integrate.api.nvidia.com/v1",
  });
  assert.equal(dupe.ok, false);
  assert.match(dupe.ok ? "" : dupe.reason, /already in model_list/);

  const noList = insertModelEntry("router_settings:\n  fallbacks:\n", {
    name: "code-1-a-model-x",
    modelId: "model-x",
    baseUrl: "https://api.experientiallabs.ai/v1",
  });
  assert.equal(noList.ok, false);
  assert.match(noList.ok ? "" : noList.reason, /model_list/);
});

test("the dialog shows the entry, the rank and the tier it is agreeing to", () => {
  const options = upstreamOptions(CONFIG);
  const nvidia = options[0];
  const model = {
    name: "code-8-nvidia-deepseek-v4.1-flash",
    modelId: "deepseek-v4.1-flash",
    baseUrl: nvidia.baseUrl,
    apiKey: nvidia.apiKey,
  };

  const ranked = describeAddition(model, nvidia, 39.5);
  assert.match(ranked, /^- model_name: code-8-nvidia-deepseek-v4\.1-flash$/m);
  assert.match(ranked, /^ {4}model: openai\/deepseek-v4\.1-flash$/m);
  assert.match(ranked, /AAII 39\.5/);
  assert.match(ranked, /tier: +daily/);

  const unscored = describeAddition(model, nvidia, undefined);
  assert.match(unscored, /no AAII score/);
  assert.match(unscored, /sorts after every scored model/);

  const unclassified = options.find((option) => option.host === "relay.example.invalid") ?? {
    ...nvidia,
    host: "relay.example.invalid",
    tier: 99,
    tierLabel: "unclassified",
  };
  assert.match(describeAddition(model, unclassified, 39.5), /not in the tier table/);
});

test("completions offer the subcommands, then the host slugs after add", () => {
  assert.deepEqual(completionsFor("").map((item) => item.value), SUBCOMMANDS.map((item) => item.value));
  assert.deepEqual(completionsFor("s").map((item) => item.value), ["sync"]);
  assert.deepEqual(completionsFor("nope"), []);
  assert.deepEqual(
    completionsFor("add deepseek-v4.1-flash ", ["nvidia", "explabs"]).map((item) => item.value),
    ["add deepseek-v4.1-flash nvidia ", "add deepseek-v4.1-flash explabs "],
  );
  assert.deepEqual(
    completionsFor("add deepseek-v4.1-flash e", ["nvidia", "explabs"]).map((item) => item.value),
    ["add deepseek-v4.1-flash explabs "],
  );
  assert.deepEqual(completionsFor("add deepseek-v4.1-flash nvidia ", ["nvidia"]), []);
  assert.deepEqual(completionsFor("add", ["nvidia"]).map((item) => item.value), ["add"], "the model id is the operator's to type");
});

test("the score snapshot is what decides whether a model is ranked", () => {
  // Not a rule of this module, but the one the dialog reads: a model the table
  // does not cover must reach `describeAddition` as unscored, never as 0.
  const score = SCORES.scores.get("deepseek-v4-1-flash")?.score;
  assert.equal(score, 39.5);
  assert.equal(SCORES.scores.get("never-heard-of-it"), undefined);
});
