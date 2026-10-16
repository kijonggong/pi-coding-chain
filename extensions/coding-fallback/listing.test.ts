/**
 * Tests for reading an upstream's own model listing.
 *
 * Run with:
 *   node --test extensions/coding-fallback/listing.test.ts
 *
 * The request tests run against a server this file starts on the loopback
 * interface, so the fetch path (headers, status handling, parsing, timeout) is
 * exercised for real rather than against a stubbed `fetch`. No test reaches the
 * network: the only host contacted is 127.0.0.1.
 */

import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";
import {
  listUpstreamModels,
  listingUrl,
  parseListing,
  resolveKey,
} from "./listing.ts";

interface Reply {
  readonly status?: number;
  readonly body?: string;
  readonly delayMs?: number;
}

let lastRequest: { readonly url?: string; readonly authorization?: string } | undefined;

/** Start a one-shot OpenAI-shaped endpoint and hand back its base URL. */
async function serve(reply: Reply): Promise<string> {
  const server = createServer((request, response) => {
    lastRequest = { url: request.url, authorization: request.headers.authorization };
    const answer = (): void => {
      response.writeHead(reply.status ?? 200, { "content-type": "application/json" });
      response.end(reply.body ?? "{}");
    };
    if (reply.delayMs === undefined) answer();
    else setTimeout(answer, reply.delayMs);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}/v1`;
}

const servers: ReturnType<typeof createServer>[] = [];
after(() => {
  for (const server of servers) server.close();
});

test("reads the key the way the config writes it", () => {
  assert.equal(resolveKey("os.environ/EXPLABS_API_KEY", { EXPLABS_API_KEY: "sk-test" }), "sk-test");
  assert.equal(
    resolveKey("os.environ/MISSING", {}),
    undefined,
    "a variable that is not set is not a key, and is not an error",
  );
  assert.equal(resolveKey("os.environ/EMPTY", { EMPTY: "   " }), undefined);
  assert.equal(resolveKey("sk-literal"), "sk-literal", "a literal key in the config is used as it stands");
  assert.equal(resolveKey(undefined), undefined);
});

test("derives the listing URL from the api_base the config carries", () => {
  assert.equal(listingUrl("https://integrate.api.nvidia.com/v1"), "https://integrate.api.nvidia.com/v1/models");
  assert.equal(listingUrl("https://example.test/v1/"), "https://example.test/v1/models");
  assert.equal(listingUrl("http://127.0.0.1:28180/v1"), "http://127.0.0.1:28180/v1/models");
  assert.equal(listingUrl("ftp://example.test/v1"), undefined);
  assert.equal(listingUrl("not a url"), undefined);
});

test("parses the listing shapes endpoints actually return", () => {
  assert.deepEqual(parseListing({ data: [{ id: "b" }, { id: "a" }, { id: "a" }] }), ["a", "b"]);
  assert.deepEqual(parseListing({ models: [{ id: "glm-5.3-flash" }] }), ["glm-5.3-flash"]);
  assert.deepEqual(parseListing([{ id: "z" }]), ["z"]);
  assert.deepEqual(parseListing({ data: ["plain-id"] }), ["plain-id"]);
  assert.deepEqual(
    parseListing({ data: { "map-key": { object: "model" } } }),
    ["map-key"],
    "a map keyed by id, as some gateways answer",
  );
  assert.deepEqual(parseListing({ data: [{ id: "  " }, { object: "model" }] }), [], "an entry with no id is not a model");
  assert.deepEqual(parseListing("nope"), []);
  assert.deepEqual(parseListing({ error: "unauthorized" }), []);
});

test("reads a listing from a real endpoint, sending the key it found", async () => {
  const baseUrl = await serve({ body: JSON.stringify({ data: [{ id: "model-b" }, { id: "model-a" }] }) });
  const result = await listUpstreamModels(
    { baseUrl, apiKey: "os.environ/TEST_KEY" },
    5_000,
    { TEST_KEY: "sk-from-env" },
  );

  assert.deepEqual(result, { ok: true, ids: ["model-a", "model-b"] });
  assert.equal(lastRequest?.url, "/v1/models");
  assert.equal(lastRequest?.authorization, "Bearer sk-from-env");
});

test("asks without a key when the host has none configured", async () => {
  const baseUrl = await serve({ body: JSON.stringify({ data: [{ id: "local-model" }] }) });
  const result = await listUpstreamModels({ baseUrl }, 5_000, {});

  assert.equal(result.ok, true);
  assert.equal(lastRequest?.authorization, undefined);
});

test("reports a status instead of throwing, and names the likely cause of a 401", async () => {
  const unauthorized = await serve({ status: 401, body: "{}" });
  const denied = await listUpstreamModels({ baseUrl: unauthorized, apiKey: "os.environ/GONE" }, 5_000, {});
  assert.equal(denied.ok, false);
  assert.match(denied.ok ? "" : denied.reason, /401/);
  assert.match(denied.ok ? "" : denied.reason, /key may not be in this shell/);

  const broken = await serve({ status: 500, body: "{}" });
  const failed = await listUpstreamModels({ baseUrl: broken }, 5_000, {});
  assert.match(failed.ok ? "" : failed.reason, /500/);
});

test("reports a listing that carried no models, and a slow endpoint", async () => {
  const empty = await serve({ body: JSON.stringify({ data: [] }) });
  const none = await listUpstreamModels({ baseUrl: empty }, 5_000, {});
  assert.equal(none.ok, false);
  assert.match(none.ok ? "" : none.reason, /listed no models/);

  const slow = await serve({ delayMs: 400, body: JSON.stringify({ data: [{ id: "late" }] }) });
  const timedOut = await listUpstreamModels({ baseUrl: slow }, 50, {});
  assert.equal(timedOut.ok, false);
  assert.match(timedOut.ok ? "" : timedOut.reason, /did not answer within/);
});

test("reports a payload that is not JSON", async () => {
  const garbage = await serve({ body: "<html>not json</html>" });
  const result = await listUpstreamModels({ baseUrl: garbage }, 5_000, {});
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /could not be read|listed no models/);
});

test("reports a base URL it cannot use", async () => {
  const result = await listUpstreamModels({ baseUrl: "not-a-url" }, 50, {});
  assert.equal(result.ok, false);
  assert.match(result.ok ? "" : result.reason, /not an http\(s\) base URL/);
});
