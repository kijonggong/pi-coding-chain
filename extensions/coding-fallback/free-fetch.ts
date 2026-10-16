/**
 * Read the live model listing from each probe target and cache it as a snapshot.
 *
 * Why cached rather than read on demand
 * -------------------------------------
 * A free promo is transient — `ling-3.1-flash` was published at $0 in and $0 out
 * and was withdrawn from the ExpLabs listing within twelve hours — so a check
 * that only reads the endpoint when someone runs a command misses the window
 * entirely. The snapshot is the memory of what the listing said the last time it
 * was read, including promos that have since ended and groups that were wired
 * into `model_list` because of them.
 *
 * What it refuses to do
 * ---------------------
 * A failed probe never overwrites the snapshot. Writing an empty listing after a
 * network error would look exactly like "the promo ended", and the next compose
 * would tear down groups that are still free. A host that could not be read is
 * simply absent from the snapshot, and `coveredHosts()` keeps its groups in place.
 *
 * No Pi SDK imports here, so the CLI script and the extension share one path.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  FREE_PROBE_TARGETS,
  buildFreeSnapshot,
  buildProviderSnapshot,
  parseFreeSnapshot,
  snapshotAgeMs,
} from "./free-models.ts";
import type { FreeProbeTarget, ProviderFreeSnapshot } from "./free-models.ts";

/** Six hours: a promo that lives a day is seen several times, without probing every session. */
export const DEFAULT_FRESHNESS_MS = 6 * 60 * 60 * 1000;

export const ATTRIBUTION =
  "Read directly from each upstream's own OpenAI-compatible /models listing, with the operator's key. " +
  "No third party is involved and no price is estimated: a missing price is recorded as missing, not as zero.";

export interface RefreshOutcome {
  readonly state: "written" | "refreshed" | "skipped" | "error";
  readonly message: string;
  readonly path: string;
  /** Providers read on this run. Empty when nothing was fetched. */
  readonly providers: readonly ProviderFreeSnapshot[];
}

export interface RefreshOptions {
  readonly path: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly targets?: readonly FreeProbeTarget[];
  /** Give up on a single probe after this long. */
  readonly timeoutMs?: number;
  /** Skip the network when the snapshot is younger than this. */
  readonly freshnessMs?: number;
  /** Probe even when the snapshot is fresh. */
  readonly force?: boolean;
  /** Read the listings and report, without touching the snapshot file. */
  readonly dryRun?: boolean;
  readonly now?: number;
}

async function probe(target: FreeProbeTarget, apiKey: string, timeoutMs: number): Promise<unknown> {
  const response = await fetch(`${target.baseUrl}/models`, {
    headers: { accept: "application/json", authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function readExisting(path: string): Promise<ReturnType<typeof parseFreeSnapshot>> {
  try {
    return parseFreeSnapshot(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** Payload equality ignores `retrieved`, so a re-probe that sees the same listing is not churn. */
function payloadOf(snapshot: { providers: readonly ProviderFreeSnapshot[] }): string {
  return JSON.stringify(snapshot.providers);
}

export async function refreshFreeSnapshot(options: RefreshOptions): Promise<RefreshOutcome> {
  const {
    path,
    env = process.env,
    targets = FREE_PROBE_TARGETS,
    timeoutMs = 12_000,
    freshnessMs = DEFAULT_FRESHNESS_MS,
    force = false,
    dryRun = false,
    now = Date.now(),
  } = options;

  const existing = await readExisting(path);
  const age = snapshotAgeMs(existing, now);
  if (!force && existing && age !== undefined && age < freshnessMs) {
    return {
      state: "skipped",
      message: `free-model snapshot is ${Math.round(age / 60_000)}m old (freshness window ${Math.round(freshnessMs / 60_000)}m)`,
      path,
      providers: existing.providers,
    };
  }

  const providers: ProviderFreeSnapshot[] = [];
  const failures: string[] = [];
  const missingKeys: string[] = [];

  for (const target of targets) {
    const key = env[target.apiKeyEnv];
    if (!key || key.trim() === "") {
      missingKeys.push(`${target.host} ($${target.apiKeyEnv})`);
      continue;
    }
    try {
      const listing = await probe(target, key, timeoutMs);
      providers.push(buildProviderSnapshot(target, listing, new Date(now).toISOString()));
    } catch (error) {
      failures.push(`${target.host}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (providers.length === 0) {
    const reasons = [...missingKeys, ...failures];
    return {
      state: "error",
      message:
        `no listing could be read (${reasons.join("; ") || "no probe target"}); the snapshot at ${path} is unchanged`,
      path,
      providers: existing?.providers ?? [],
    };
  }

  const snapshot = buildFreeSnapshot(providers, new Date(now).toISOString(), ATTRIBUTION);
  const changed = payloadOf(snapshot) !== payloadOf({ providers: existing?.providers ?? [] });

  if (dryRun) {
    return {
      state: changed ? "written" : "refreshed",
      message: `dry run: read ${providers.length} listing(s); would ${changed ? "write" : "keep"} ${path}`,
      path,
      providers,
    };
  }

  try {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.tmp`;
    await writeFile(temp, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    await rename(temp, path);
  } catch (error) {
    return {
      state: "error",
      message: `cannot write ${path} (${error instanceof Error ? error.message : String(error)}); the previous snapshot still applies`,
      path,
      providers,
    };
  }

  const free = providers.reduce((total, provider) => total + provider.free.length, 0);
  const tail = [...missingKeys.map((entry) => `no key for ${entry}`), ...failures];
  const suffix = tail.length > 0 ? `; ${tail.join("; ")}` : "";

  return changed
    ? {
        state: "written",
        message: `read ${providers.length} listing(s), ${free} free model(s)${suffix}`,
        path,
        providers,
      }
    : {
        state: "refreshed",
        message: `listing unchanged, ${free} free model(s)${suffix}`,
        path,
        providers,
      };
}
