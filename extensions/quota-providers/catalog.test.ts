/**
 * Tests for the quota-tier provider catalog.
 *
 * Run with:
 *   node --test extensions/quota-providers/catalog.test.ts
 *
 * The catalog is data, so most tests here guard the invariants that make the
 * data safe to register: a complete field set, a sane output limit, unique ids,
 * and a host the tier table can actually classify. The last test compares the
 * catalog against the live LiteLLM config, and skips when that file is absent.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { readModelEntries } from "../coding-fallback/chain.ts";
import { TIER_UNKNOWN, tierForHost } from "../coding-fallback/providers.ts";
import { DASHSCOPE, EXCLUDED_MODELS, EXPLABS, MAX_OUTPUT_CAVEAT, PROVIDERS, modelIds } from "./catalog.ts";
import { providerConfig, report } from "./index.ts";

const LIVE_CONFIG =
  process.env.PI_CODING_FALLBACK_CONFIG ?? join(homedir(), ".pi", "agent", "litellm_config.yaml");

function hostOf(baseUrl: string): string {
  return new URL(baseUrl).hostname;
}

test("registers the two hosts the LiteLLM proxy was the only route to", () => {
  assert.deepEqual(
    PROVIDERS.map((provider) => provider.id),
    ["dashscope", "explabs"],
  );
  assert.equal(hostOf(DASHSCOPE.baseUrl), "dashscope-intl.aliyuncs.com");
  assert.equal(hostOf(EXPLABS.baseUrl), "api.experientiallabs.ai");
  assert.equal(DASHSCOPE.apiKeyEnv, "DASHSCOPE_API_KEY");
  assert.equal(EXPLABS.apiKeyEnv, "EXPLABS_API_KEY");
});

test("each provider host has a quota tier, so the router can rank it", () => {
  for (const provider of PROVIDERS) {
    const tier = tierForHost(hostOf(provider.baseUrl));
    assert.notEqual(
      tier,
      TIER_UNKNOWN,
      `${provider.id} is served from ${provider.baseUrl}, which providers.ts cannot classify`,
    );
  }
});

test("every model carries the fields registerProvider requires", () => {
  for (const provider of PROVIDERS) {
    assert.ok(provider.models.length > 0, `${provider.id} registers no models`);
    for (const model of provider.models) {
      const where = `${provider.id}/${model.id}`;
      assert.ok(model.id.length > 0, `${where} has an empty id`);
      assert.ok(model.name.length > 0, `${where} has an empty name`);
      assert.ok(model.input.length > 0, `${where} declares no input modality`);
      assert.equal(typeof model.reasoning, "boolean", `${where} must declare reasoning`);
      for (const [field, value] of [
        ["contextWindow", model.contextWindow],
        ["maxTokens", model.maxTokens],
        ["cost.input", model.cost.input],
        ["cost.output", model.cost.output],
        ["cost.cacheRead", model.cost.cacheRead],
        ["cost.cacheWrite", model.cost.cacheWrite],
      ] as const) {
        assert.equal(typeof value, "number", `${where} ${field} must be a number`);
        assert.ok(Number.isFinite(value) && value >= 0, `${where} ${field} is ${value}`);
      }
      assert.ok(model.source.length > 0, `${where} does not record where its limits came from`);
    }
  }
});

test("an output limit never reaches the context window", () => {
  // Two Alibaba pages publish a maximum output equal to the context window,
  // which leaves no room for the prompt. Overstating maxTokens makes the
  // provider reject the request, so those entries take the smaller figure and
  // this test keeps a later edit from pasting the published number back in.
  for (const provider of PROVIDERS) {
    for (const model of provider.models) {
      assert.ok(
        model.maxTokens < model.contextWindow,
        `${provider.id}/${model.id}: maxTokens ${model.maxTokens} must stay under contextWindow ${model.contextWindow}`,
      );
    }
  }
  assert.ok(MAX_OUTPUT_CAVEAT.includes("context window"));
});

test("model ids are unique within and across providers", () => {
  const seen = new Map<string, string>();
  for (const provider of PROVIDERS) {
    const ids = modelIds(provider);
    assert.equal(new Set(ids).size, ids.length, `${provider.id} repeats a model id`);
    for (const id of ids) {
      const owner = seen.get(id);
      assert.equal(owner, undefined, `${id} is declared by both ${owner} and ${provider.id}`);
      seen.set(id, provider.id);
    }
  }
});

test("the registered config interpolates the key from the environment", () => {
  for (const provider of PROVIDERS) {
    const config = providerConfig(provider);
    assert.equal(config.apiKey, `$${provider.apiKeyEnv}`);
    assert.equal(config.api, "openai-completions");
    assert.equal(config.models.length, provider.models.length);
    for (const [index, model] of config.models.entries()) {
      const source = provider.models[index];
      assert.equal(model.id, source.id);
      assert.equal(model.contextWindow, source.contextWindow);
      assert.equal(model.maxTokens, source.maxTokens);
      assert.deepEqual(model.cost, source.cost, `${provider.id}/${model.id} cost was not copied`);
      // A fresh array and object per model, so a consumer cannot mutate the catalog.
      assert.notEqual(model.input, source.input);
      assert.notEqual(model.cost, source.cost);
    }
  }
});

test("reports every registered model and each exclusion", () => {
  const text = report();
  for (const provider of PROVIDERS) {
    assert.ok(text.includes(`${provider.id}: ${provider.models.length} models`), `${provider.id} missing from report`);
    for (const model of provider.models) {
      assert.ok(text.includes(model.id), `${model.id} missing from report`);
    }
  }
  for (const entry of EXCLUDED_MODELS) {
    assert.ok(text.includes(`excluded ${entry.id}`), `${entry.id} exclusion missing from report`);
  }
});

test("the live LiteLLM config's targets on these hosts are all accounted for", async (t) => {
  const text = await readFile(LIVE_CONFIG, "utf8").catch(() => undefined);
  if (text === undefined) {
    t.skip(`no LiteLLM config at ${LIVE_CONFIG}`);
    return;
  }

  const registered = new Set(PROVIDERS.flatMap((provider) => modelIds(provider)));
  const excluded = new Set(EXCLUDED_MODELS.map((entry) => entry.id));
  const hosts = new Set(PROVIDERS.map((provider) => hostOf(provider.baseUrl)));

  const targets = readModelEntries(text.split("\n")).filter((entry) => hosts.has(entry.host));
  assert.ok(targets.length > 0, "the live config routes nothing to the registered hosts");

  const unaccounted = targets
    .filter((entry) => !registered.has(entry.upstream) && !excluded.has(entry.upstream))
    .map((entry) => `${entry.name} -> ${entry.upstream}`);
  assert.deepEqual(unaccounted, [], `these LiteLLM targets are neither registered nor excluded: ${unaccounted}`);
});
