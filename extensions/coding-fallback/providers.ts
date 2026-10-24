/**
 * Upstream provider quota tiers.
 *
 * The fallback chain prefers the capacity that replenishes soonest, because
 * spending a quota that resets tomorrow costs less than spending credit. So a
 * tier is the ordering key for two entries that serve the same model at the
 * same Artificial Analysis score:
 *
 *   free  <  daily  <  weekly  <  monthly  <  credit
 *
 * "free" means there is no metered allowance at all: the caller hosts the model
 * itself. Lower sorts first.
 *
 * Every classification below is either confirmed by the operator of this
 * configuration or derived from the upstream's own documentation; the `source`
 * field records which, so a wrong entry can be traced instead of guessed at.
 * A host that is missing from the table sorts last and is reported, never
 * silently treated as free.
 */

export const TIER_FREE = 0;
export const TIER_DAILY = 1;
export const TIER_WEEKLY = 2;
export const TIER_MONTHLY = 3;
export const TIER_CREDIT = 4;

/** Sorts after every known tier, so an unclassified host never wins a tie. */
export const TIER_UNKNOWN = 99;

export interface ProviderTier {
  /** Hostname from the model entry's `api_base`. */
  readonly host: string;
  readonly tier: number;
  readonly label: string;
  /** Who or what established this classification. */
  readonly source: string;
}

export const PROVIDER_TIERS: readonly ProviderTier[] = [
  {
    host: "100.78.239.122",
    tier: TIER_FREE,
    label: "free",
    source: "self-hosted on the operator's tailnet (Strata); no metered allowance",
  },
  {
    host: "127.0.0.1",
    tier: TIER_DAILY,
    label: "daily",
    source: "local relay in front of Cline; pi-freeflow documents a daily free limit",
  },
  {
    host: "integrate.api.nvidia.com",
    tier: TIER_DAILY,
    label: "daily",
    source: "confirmed by the configuration's operator",
  },
  {
    host: "api.commandcode.ai",
    tier: TIER_WEEKLY,
    label: "weekly",
    source: "confirmed by the configuration's operator; this upstream serves DeepSeek V4.1 Flash only",
  },
  {
    host: "api.experientiallabs.ai",
    tier: TIER_MONTHLY,
    label: "monthly",
    source:
      "tier confirmed by the configuration's operator, who reports this upstream as GLM-5.3 Flash " +
      "only, with a specific coding model occasionally free on promo. This supersedes an earlier " +
      "report of DeepSeek V4.1 Flash only. The config still carries " +
      "code-7-explabs-deepseek-v4.1-flash and code-1-explabs-qwen3.8-flash-next-uncensored on this " +
      "host. The tier does not depend on which model it serves.",
  },
  {
    host: "dashscope-intl.aliyuncs.com",
    tier: TIER_CREDIT,
    label: "credit",
    source: "confirmed by the configuration's operator",
  },
];

const BY_HOST = new Map(PROVIDER_TIERS.map((entry) => [entry.host.toLowerCase(), entry]));

/**
 * The tier this host charges, independent of which model it serves.
 *
 * A per-model override sits in front of this: a model the free-model snapshot
 * reports at zero cost is `free` on the day it is free, whatever the host's
 * standing tier says. See `tierForEntry` in `chain.ts`, which is the function the
 * ordering actually calls.
 */
export function tierForHost(host: string): number {
  return BY_HOST.get(host.toLowerCase())?.tier ?? TIER_UNKNOWN;
}

export function tierLabelForHost(host: string): string {
  return BY_HOST.get(host.toLowerCase())?.label ?? "unclassified";
}

/** Hosts referenced by a model list that the tier table does not cover. */
export function unclassifiedHosts(hosts: Iterable<string>): string[] {
  const missing = new Set<string>();
  for (const host of hosts) {
    if (host && !BY_HOST.has(host.toLowerCase())) missing.add(host);
  }
  return [...missing].sort();
}

/** Parse API: an invalid provider URL has no source; callers decide its meaning. */
export function parseProviderUrl(value: string | undefined): {
  readonly hostname: string;
  readonly origin: string;
  readonly protocol: string;
} | undefined {
  if (value === undefined) return undefined;
  try {
    const url = new URL(value);
    return { hostname: url.hostname, origin: `${url.protocol}//${url.host}`, protocol: url.protocol };
  } catch {
    return undefined;
  }
}
