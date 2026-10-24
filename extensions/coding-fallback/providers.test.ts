import assert from "node:assert/strict";
import { test } from "node:test";
import { parseProviderUrl } from "./providers.ts";

test("provider URL parsing retains origin ports, normalizes hosts, and reports invalid input", () => {
  assert.deepEqual(parseProviderUrl("HTTPS://API.EXAMPLE:8443/v1?q=x"), {
    hostname: "api.example", origin: "https://api.example:8443", protocol: "https:",
  });
  assert.equal(parseProviderUrl("broken"), undefined);
  assert.equal(parseProviderUrl(undefined), undefined);
});
