/**
 * Pi extension: narrow the OpenRouter model list to a chosen allowlist, and let
 * the operator turn that off from inside Pi.
 *
 * The allowlist replaces the provider's whole catalog, so `off` cannot mean
 * "filter less" — it means removing the override and letting Pi compose the
 * provider itself, exactly as it would with this extension uninstalled. That is
 * what `pi.unregisterProvider("openrouter")` does, and it is why the switch is
 * not a filter strength but a presence/absence:
 *
 *   /openrouter-catalog-filter status   what is in force, and what it keeps
 *   /openrouter-catalog-filter off      stop overriding the catalog
 *   /openrouter-catalog-filter on       narrow it again
 *   /openrouter-catalog-filter reload   fetch the catalog again
 *   /openrouter-catalog-filter list     the model ids the allowlist keeps
 *
 * The choice is kept in `openrouter-catalog-filter.json` under the agent
 * directory, and `PI_OPENROUTER_FILTER` overrides it for one process
 * (`PI_OPENROUTER_FILTER_STATE` points the file elsewhere). Its default is
 * `on`: the extension was already narrowing the catalog before it had a switch,
 * and upgrading must not silently widen anyone's model list.
 *
 * A session start reads the state, so a choice made in the TUI is in force
 * before the first request of the next session.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { getBuiltinModels } from "@earendil-works/pi-ai/providers/all";
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";
import {
  STATE_ENV,
  STATE_FILE,
  STATE_PATH_ENV,
  SUBCOMMANDS,
  completionsFor,
  describeState,
  loadState,
  saveState,
} from "./state.ts";
import type { ResolvedState } from "./state.ts";

const COMMAND = "openrouter-catalog-filter";
const PROVIDER = "openrouter";
const CATALOG_URL = "https://pi.dev/api/models/providers/openrouter";
const REQUEST_TIMEOUT_MS = 10_000;

// This extension is an allowlist: only the model families below stay visible for
// the OpenRouter provider. Everything else in the catalog is hidden.
//
//   1. ":free" — the free tier, any family.
//   2. ids ending in "-alpha".
//   3. The DeepSeek V4.1 Flash family, including tier variants such as
//      "deepseek/deepseek-v4.1-flash:batch". The lookalike
//      "deepseek/deepseek-v4-flash" (no ".1") is deliberately not matched.
//   4. Pi's virtual routing ids "auto" and "openrouter/auto".
const ALLOWED_ALPHA_SUFFIX = "-alpha";
const ALLOWED_DEEPSEEK_V41_FLASH_PREFIX = "deepseek/deepseek-v4.1-flash";
const ALLOWED_VIRTUAL_ROUTING_IDS = new Set(["auto", "openrouter/auto"]);

// Retired models: no longer served by OpenRouter, kept in one place so the
// allowlist rules below cannot readmit them. Checked against
// https://openrouter.ai/api/v1/models, which lists every chat model OpenRouter
// currently serves — a live ":free" tier appears there alongside its paid id.
//
// Only these are retired. The other ":free" models the allowlist exposes
// (dots-studio/dots-3-note-preview, inclusionai/ling-3.0-flash-sante,
// liquid/lfm-2.5-2.6b) are still served.
//
// - minimax/minimax-m2.7:free, minimax/minimax-m3:free, z-ai/glm-5.2:free,
//   inclusionai/ling-3.0-flash-fin:free, qwen/qwen3.8-27b:free: the paid ids are
//   live, the ":free" tiers are not. They no longer appear in any catalog this
//   extension reads, so this guards against an older Pi build or a stale
//   snapshot reintroducing them.
// - stealth/space-bunny-alpha: absent entirely, yet the bundled and stored
//   fallback catalogs still carry it and it matches the "-alpha" rule.
const UNSERVED_OPENROUTER_MODELS = new Set([
  "inclusionai/ling-3.0-flash-fin:free",
  "minimax/minimax-m2.7:free",
  "minimax/minimax-m3:free",
  "qwen/qwen3.8-27b:free",
  "stealth/space-bunny-alpha",
  "z-ai/glm-5.2:free",
]);

type CatalogModel = ProviderModelConfig & { id: string };

/** Which of the three catalog sources answered. */
type CatalogSource = "remote" | "store" | "builtin";

interface SkippedCatalogSource {
  readonly source: CatalogSource;
  readonly reason: string;
}

interface LoadedCatalog {
  /** What the allowlist keeps. */
  readonly models: CatalogModel[];
  /** How many the catalog offered before the allowlist. */
  readonly total: number;
  readonly source: CatalogSource;
  readonly skipped: readonly SkippedCatalogSource[];
}

function isAllowedModel(id: string): boolean {
  if (UNSERVED_OPENROUTER_MODELS.has(id)) {
    return false;
  }

  if (id.endsWith(":free")) {
    return true;
  }

  if (id.endsWith(ALLOWED_ALPHA_SUFFIX)) {
    return true;
  }

  if (
    id === ALLOWED_DEEPSEEK_V41_FLASH_PREFIX ||
    id.startsWith(`${ALLOWED_DEEPSEEK_V41_FLASH_PREFIX}:`)
  ) {
    return true;
  }

  return ALLOWED_VIRTUAL_ROUTING_IDS.has(id);
}

function toModels(payload: unknown): CatalogModel[] {
  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === "object") {
    const maybeModels = (payload as { models?: unknown }).models;
    if (Array.isArray(maybeModels)) {
      return maybeModels;
    }

    return Object.values(payload as Record<string, CatalogModel>);
  }

  return [];
}

function filterModels(models: readonly unknown[]): CatalogModel[] {
  return models.flatMap((model) => {
    if (!model || typeof model !== "object") {
      return [];
    }

    const id = (model as { id?: unknown }).id;
    if (typeof id !== "string" || !isAllowedModel(id)) {
      return [];
    }

    return [model as CatalogModel];
  });
}

/** Apply the allowlist, and record what it read, for the report. */
function applyAllowlist(
  models: readonly unknown[],
  source: CatalogSource,
  skipped: readonly SkippedCatalogSource[] = [],
): LoadedCatalog {
  return { models: filterModels(models), total: models.length, source, skipped };
}

async function fetchRemoteModels(signal?: AbortSignal): Promise<CatalogModel[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortFromCaller = () => controller.abort();

  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  try {
    const response = await fetch(CATALOG_URL, {
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "User-Agent": "pi-openrouter-catalog-filter/1.0",
      },
    });

    if (!response.ok) {
      throw new Error(`OpenRouter catalog request failed: ${response.status}`);
    }

    return toModels(await response.json());
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}

async function fetchRemoteCatalog(signal?: AbortSignal): Promise<LoadedCatalog> {
  const catalog = applyAllowlist(await fetchRemoteModels(signal), "remote");
  if (catalog.models.length === 0) {
    throw new Error("OpenRouter catalog response contained no allowed models");
  }
  return catalog;
}

async function readStoredModels(
  skipped: readonly SkippedCatalogSource[],
): Promise<
  | { readonly ok: true; readonly catalog: LoadedCatalog }
  | { readonly ok: false; readonly reason: string }
> {
  const catalogPath = join(getAgentDir(), "models-store.json");
  let text: string;
  try {
    text = await readFile(catalogPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { ok: false, reason: "the file was missing" };
    }
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `could not read ${catalogPath}: ${message}` };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: "the JSON was broken" };
  }

  const payload =
    raw && typeof raw === "object"
      ? (raw as { openrouter?: unknown }).openrouter ?? raw
      : raw;
  const loaded = applyAllowlist(toModels(payload), "store", skipped);
  if (loaded.models.length === 0) {
    return { ok: false, reason: "there were no allowed models" };
  }
  return { ok: true, catalog: loaded };
}

function builtinFallbackModels(
  skipped: readonly SkippedCatalogSource[],
): LoadedCatalog {
  return applyAllowlist(getBuiltinModels("openrouter"), "builtin", skipped);
}

async function loadCatalog(
  signal?: AbortSignal,
  allowNetwork = true,
): Promise<LoadedCatalog> {
  const skipped: SkippedCatalogSource[] = [];

  if (process.env.PI_OFFLINE === "1") {
    skipped.push({ source: "remote", reason: "PI_OFFLINE=1" });
  } else if (!allowNetwork) {
    skipped.push({ source: "remote", reason: "network disabled" });
  } else {
    try {
      return await fetchRemoteCatalog(signal);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      skipped.push({ source: "remote", reason });
    }
  }

  const stored = await readStoredModels(skipped);
  if (stored.ok) {
    return stored.catalog;
  }
  skipped.push({ source: "store", reason: stored.reason });

  return builtinFallbackModels(skipped);
}

function statePath(): string {
  const override = process.env[STATE_PATH_ENV];
  return override && override.trim() !== "" ? override : join(getAgentDir(), STATE_FILE);
}

function formatCatalogSource(catalog: LoadedCatalog): string {
  if (catalog.skipped.length === 0) {
    return catalog.source;
  }
  const details = catalog.skipped
    .map((item) => `${item.source} skipped: ${item.reason}`)
    .join("; ");
  return `${catalog.source}; ${details}`;
}

function report(state: ResolvedState, catalog: LoadedCatalog, path: string): string {
  const lines = [`${COMMAND}: ${describeState(state, path)}`];
  lines.push(
    state.enabled
      ? `catalog: ${catalog.models.length} of ${catalog.total} models visible (${formatCatalogSource(catalog)})`
      : "override: removed, so Pi composes the OpenRouter provider itself",
  );
  for (const note of state.notes) lines.push(`! ${note}`);
  return lines.join("\n");
}

export default async function (pi: ExtensionAPI) {
  const path = statePath();
  let catalog = await loadCatalog();
  let state = await loadState(path, process.env);

  // `off` removes the override instead of widening the filter: the provider then
  // composes exactly as it would without this extension.
  const apply = (): void => {
    if (!state.enabled) {
      pi.unregisterProvider(PROVIDER);
      return;
    }
    pi.registerProvider(PROVIDER, {
      models: catalog.models,
      async refreshModels({ signal, allowNetwork }) {
        catalog = await loadCatalog(signal, allowNetwork);
        return catalog.models;
      },
    });
  };

  apply();

  pi.registerCommand(COMMAND, {
    description: "Turn the OpenRouter catalog allowlist on or off",
    getArgumentCompletions: (prefix) =>
      completionsFor(prefix).map((item) => ({ value: item.value, label: item.value, description: item.description })),
    handler: async (args, ctx) => {
      const subcommand = (args ?? "").trim().toLowerCase() || "status";
      if (!ctx) return;

      switch (subcommand) {
        case "status":
          ctx.ui?.notify?.(report(state, catalog, path), "info");
          return;

        case "list":
          ctx.ui?.notify?.(catalog.models.map((model) => model.id).join("\n"), "info");
          return;

        case "on":
        case "off": {
          const enabled = subcommand === "on";
          try {
            await saveState(path, enabled);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.ui?.notify?.(`${COMMAND}: could not write ${path}: ${message}`, "error");
            return;
          }
          state = await loadState(path, process.env);
          apply();
          // The file was written either way; the environment is the one source
          // the command cannot write, so it says when it is the one in force.
          const overridden = state.source === "env";
          ctx.ui?.notify?.(
            `${COMMAND}: allowlist ${state.enabled ? "on" : "off"} — ` +
              (state.enabled
                ? `${catalog.models.length} of ${catalog.total} OpenRouter models visible (${formatCatalogSource(catalog)})`
                : "Pi composes the OpenRouter provider itself") +
              (overridden ? ` (written, but ${STATE_ENV} decides this session until it changes)` : ""),
            overridden ? "warning" : "info",
          );
          return;
        }

        case "reload": {
          catalog = await loadCatalog();
          state = await loadState(path, process.env);
          apply();
          ctx.ui?.notify?.(report(state, catalog, path), "info");
          return;
        }

        default:
          ctx.ui?.notify?.(
            `${COMMAND}: unknown subcommand \`${subcommand}\`. Try ${SUBCOMMANDS.map((entry) => entry.value).join(", ")}`,
            "warning",
          );
      }
    },
  });
}
