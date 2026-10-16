/**
 * Reading an upstream's own model listing.
 *
 * The picker offers what the selected upstream says it serves, because that is
 * the only list that answers the question the entry has to survive: does this
 * host actually have this model. The alternatives answer a different one — the
 * score snapshot knows what is worth ranking, not what the host serves, and Pi's
 * own catalog describes Pi's providers rather than a LiteLLM `api_base`.
 *
 * The key comes from the `api_key` line the config already carries for that
 * host, so nothing new is configured to look: `os.environ/NAME` reads the
 * variable (the same place LiteLLM reads it from), and a literal key is used as
 * it stands. A host with no key line is asked without one, which is what a local
 * relay wants.
 *
 * Pure where it matters: the URL, the key resolution and the parsing of the
 * payload are functions of their inputs, so they are testable without a network.
 * Only {@link listUpstreamModels} performs I/O, and it returns a reason instead
 * of throwing — an unreachable listing is a fact for the picker's title, not an
 * error that ends the command.
 */

/** Long enough for a slow listing, short enough that the picker is not a hang. */
export const DEFAULT_LISTING_TIMEOUT_MS = 8_000;

export type ListingResult =
  | { readonly ok: true; readonly ids: readonly string[] }
  | { readonly ok: false; readonly reason: string };

/**
 * The value to send as the bearer token: `os.environ/NAME` reads `NAME`, and
 * anything else is the literal the config holds. `undefined` means there is
 * nothing to send, which is not a failure — an endpoint that needs no key
 * answers without one, and one that does says so in its status.
 */
export function resolveKey(
  apiKey: string | undefined,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const raw = apiKey?.trim();
  if (raw === undefined || raw === "") return undefined;

  const prefixed = /^os\.environ\/(.+)$/.exec(raw);
  if (prefixed === null) return raw;

  const name = prefixed[1].trim();
  const value = env[name];
  return value !== undefined && value.trim() !== "" ? value : undefined;
}

/** Where an OpenAI-compatible listing lives, from the `api_base` the config carries. */
export function listingUrl(baseUrl: string): string | undefined {
  const trimmed = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(trimmed)) return undefined;
  return `${trimmed}/models`;
}

function idOf(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() === "" ? undefined : value.trim();
  if (value && typeof value === "object") {
    const id = (value as { id?: unknown }).id;
    if (typeof id === "string" && id.trim() !== "") return id.trim();
  }
  return undefined;
}

/**
 * The ids in a listing payload, deduplicated and sorted. Endpoints that claim to
 * be OpenAI-compatible return `{data: [{id}]}`; some return `{models: [...]}` (or
 * a bare data frame), and some return ids as plain strings. All three are read,
 * because the reason to look at a listing at all is that it is the host's own
 * answer, and refusing to parse it would leave the operator with no list.
 */
export function parseListing(payload: unknown): string[] {
  const source = ((): unknown[] => {
    if (Array.isArray(payload)) return payload;
    if (!payload || typeof payload !== "object") return [];
    const record = payload as Record<string, unknown>;
    for (const key of ["data", "models", "result"]) {
      const value = record[key];
      if (Array.isArray(value)) return value;
      // A map keyed by model id, as some gateways answer.
      if (value && typeof value === "object") return Object.keys(value as Record<string, unknown>);
    }
    // A map at the top level, as Ollama-shaped gateways answer.
    const keys = Object.keys(record);
    return keys.length > 0 && keys.every((key) => typeof (record as Record<string, unknown>)[key] === "object")
      ? keys
      : [];
  })();

  const ids = new Set<string>();
  for (const entry of source) {
    const id = idOf(entry);
    if (id !== undefined) ids.add(id);
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

/** Read one upstream's listing. Never throws; a failure is a reason. */
export async function listUpstreamModels(
  option: { readonly baseUrl: string; readonly apiKey?: string },
  timeoutMs: number = DEFAULT_LISTING_TIMEOUT_MS,
  env: Record<string, string | undefined> = process.env,
): Promise<ListingResult> {
  const url = listingUrl(option.baseUrl);
  if (url === undefined) return { ok: false, reason: `not an http(s) base URL: ${option.baseUrl}` };

  const key = resolveKey(option.apiKey, env);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(key === undefined ? {} : { authorization: `Bearer ${key}` }),
      },
    });

    if (!response.ok) {
      const hint = response.status === 401 || response.status === 403 ? " (the key may not be in this shell)" : "";
      return { ok: false, reason: `${url} answered ${response.status}${hint}` };
    }

    const ids = parseListing(await response.json());
    if (ids.length === 0) return { ok: false, reason: `${url} listed no models` };
    return { ok: true, ids };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    const reason = aborted
      ? `${url} did not answer within ${Math.round(timeoutMs / 1000)}s`
      : `${url} could not be read (${error instanceof Error ? error.message : String(error)})`;
    return { ok: false, reason };
  } finally {
    clearTimeout(timeout);
  }
}
