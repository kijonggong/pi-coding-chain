/**
 * Router settings: the knobs `/aaii-router settings` writes and the router
 * reads.
 *
 * Pure where it matters. Parsing, validation, the merge order and the display
 * text are functions of their inputs, so the wizard and the router agree on what
 * a value means without either of them opening the file, and a test can check
 * both. File I/O is confined to {@link loadSettings} and {@link saveSettings} at
 * the bottom, and neither imports the Pi SDK.
 *
 * Precedence is **environment > file > default**. The environment stays the
 * escape hatch: it works with no settings file and in a session with no UI,
 * which is what a scripted or headless run has. A file the operator edits by
 * hand and a file the wizard writes are the same file — the wizard only
 * validates what a human would otherwise have to spell correctly.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { DEFAULT_EXCLUDED_ORIGINS } from "./candidates.ts";
import { DEFAULT_COOLDOWN_MS } from "./cooldown.ts";

/** Re-exported so the wizard and the report describe the defaults the router
 * actually applies, rather than repeating them. */
export { DEFAULT_COOLDOWN_MS, DEFAULT_EXCLUDED_ORIGINS };

export const SETTING_KEYS = ["cooldown", "vision", "status", "origins", "providers", "models"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export interface Settings {
  /** Cooldown window in milliseconds. `0` disables the failure memory. */
  readonly cooldownMs: number;
  /** Put candidates that can see ahead of ones that cannot when a request has an image. */
  readonly preferVision: boolean;
  /** Show the active candidate and the cooling count in the footer. */
  readonly statusLine: boolean;
  /** Origins to leave out of the chain, normalized to `protocol//host`. */
  readonly excludedOrigins: readonly string[];
  /** Providers to leave out of the chain entirely, by provider id. */
  readonly excludedProviders: readonly string[];
  /**
   * `provider/id` entries that limit a provider to the models listed for it.
   * A provider with no entry keeps every model.
   */
  readonly allowedModels: readonly string[];
}

export const DEFAULT_SETTINGS: Settings = {
  cooldownMs: DEFAULT_COOLDOWN_MS,
  preferVision: true,
  statusLine: true,
  excludedOrigins: DEFAULT_EXCLUDED_ORIGINS,
  excludedProviders: [],
  allowedModels: [],
};

export type SettingKind = "duration" | "toggle" | "list";

export interface SettingDescriptor {
  readonly key: SettingKey;
  /** Menu label, also the key in the settings file. */
  readonly label: string;
  readonly kind: SettingKind;
  /** Environment variable that overrides this setting, shown in the wizard. */
  readonly envVar: string;
  /** One line of what the setting is for, shown before an edit. */
  readonly help: string;
  /** The current value as the wizard shows it. */
  readonly value: (settings: Settings) => string;
}

export const SETTINGS: readonly SettingDescriptor[] = [
  {
    key: "cooldown",
    label: "Cooldown window",
    kind: "duration",
    envVar: "PI_AAII_ROUTER_COOLDOWN_MS",
    help: "How long a model that just failed stays out of the chain. Accepts 5m, 300s or 300000. 0 turns the failure memory off.",
    value: (settings) => (settings.cooldownMs > 0 ? milliseconds(settings.cooldownMs) : "off"),
  },
  {
    key: "vision",
    label: "Image-aware order",
    kind: "toggle",
    envVar: "PI_AAII_ROUTER_VISION",
    help: "When a request carries an image, put candidates that can see it ahead of the ones that cannot. Pi replaces images with placeholders for a model without support, so off means the image is not seen.",
    value: (settings) => (settings.preferVision ? "on" : "off"),
  },
  {
    key: "status",
    label: "Footer status",
    kind: "toggle",
    envVar: "PI_AAII_ROUTER_STATUS",
    help: "Show the active candidate and how many candidates are cooling in the footer.",
    value: (settings) => (settings.statusLine ? "on" : "off"),
  },
  {
    key: "origins",
    label: "Excluded origins",
    kind: "list",
    envVar: "PI_AAII_ROUTER_EXCLUDE_ORIGINS",
    help: "Origins no candidate may use, comma separated. The default keeps the LiteLLM proxy out, because routing to it would re-enter the chain this router replaces.",
    value: (settings) => (settings.excludedOrigins.length > 0 ? settings.excludedOrigins.join(", ") : "none"),
  },
  {
    key: "providers",
    label: "Excluded providers",
    kind: "list",
    envVar: "PI_AAII_ROUTER_EXCLUDE_PROVIDERS",
    help: "Provider ids to leave out of the chain, comma separated, e.g. openrouter. An excluded provider is not a candidate even when it is authenticated.",
    value: (settings) => (settings.excludedProviders.length > 0 ? settings.excludedProviders.join(", ") : "none"),
  },
  {
    key: "models",
    label: "Allowed models",
    kind: "list",
    envVar: "PI_AAII_ROUTER_ALLOW_MODELS",
    help: "Limit a provider to the models listed for it, comma separated as provider/id, e.g. commandcode/deepseek/deepseek-v4.1-flash. A provider with no entry keeps every model.",
    value: (settings) => (settings.allowedModels.length > 0 ? settings.allowedModels.join(", ") : "none"),
  },
];

/** `300000` -> `5m`. Used for display; the file always holds milliseconds. */
export function milliseconds(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (minutes < 60) return rest === 0 ? `${minutes}m` : `${minutes}m${rest}s`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes === 0 ? `${hours}h` : `${hours}h${restMinutes}m`;
}

export interface ParsedSettings {
  readonly settings: Settings;
  /**
   * What the file said that could not be used, in the operator's words. A
   * setting read back wrong must be visible, not silently replaced by the
   * default: a chain ordered by a setting nobody chose is worse than one that
   * says which line it ignored.
   */
  readonly notes: readonly string[];
  /**
   * The keys this file actually named and that validated. A merge needs this:
   * a project file that sets one key must not reset the others to their
   * defaults on the way in.
   */
  readonly applied: readonly SettingKey[];
}

const DURATION = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i;
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const MODEL_ENTRY = /^([A-Za-z0-9][A-Za-z0-9._-]*)\/(\S+)$/;
const TOGGLE_ON = new Set(["on", "true", "yes", "1"]);
const TOGGLE_OFF = new Set(["off", "false", "no", "0"]);

function originOf(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return `${url.protocol}//${url.host}`;
  } catch {
    return undefined;
  }
}

/** `5m`, `300s`, `300000` -> milliseconds. `off` and `0` -> 0 (disabled). */
export function parseDuration(text: string): number | undefined {
  const trimmed = text.trim().toLowerCase();
  if (trimmed === "off" || trimmed === "none" || trimmed === "disabled") return 0;
  const match = DURATION.exec(trimmed);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0) return undefined;
  const unit = (match[2] ?? "ms").toLowerCase();
  const factor = unit === "h" ? 3_600_000 : unit === "m" ? 60_000 : unit === "s" ? 1000 : 1;
  return Math.round(value * factor);
}

export function parseToggle(text: string): boolean | undefined {
  const trimmed = text.trim().toLowerCase();
  if (TOGGLE_ON.has(trimmed)) return true;
  if (TOGGLE_OFF.has(trimmed)) return false;
  return undefined;
}

/** Split a comma (or whitespace) separated list, dropping blanks and repeats. */
export function parseList(text: string): string[] {
  const parts = text.split(/[,\n]/).map((part) => part.trim()).filter((part) => part !== "");
  return [...new Set(parts)];
}

/**
 * `provider/id` entries. The provider is the part before the first slash and
 * the model id may contain slashes of its own (`commandcode/deepseek/x`), so
 * only the first separator is structural. A bare model id is rejected: it
 * would say nothing about which provider it restricts.
 */
export function parseAllowedModels(text: string): {
  readonly models?: string[];
  readonly rejected: string[];
} {
  const rejected: string[] = [];
  const models: string[] = [];
  for (const entry of parseList(text)) {
    const match = MODEL_ENTRY.exec(entry);
    if (!match) {
      rejected.push(entry);
      continue;
    }
    if (!models.includes(entry)) models.push(entry);
  }
  return { models: rejected.length === 0 ? models : undefined, rejected };
}

export function parseOrigins(text: string): { readonly origins?: string[]; readonly rejected: string[] } {
  const rejected: string[] = [];
  const origins: string[] = [];
  for (const entry of parseList(text)) {
    const origin = originOf(entry);
    if (origin === undefined) {
      rejected.push(entry);
      continue;
    }
    if (!origins.includes(origin)) origins.push(origin);
  }
  return { origins: rejected.length === 0 ? origins : undefined, rejected };
}

/**
 * One setting change, validated. The wizard calls this; so would a hand edit
 * that wants its line checked.
 */
export function editSetting(
  settings: Settings,
  key: SettingKey,
  raw: string,
): { readonly ok: true; readonly settings: Settings } | { readonly ok: false; readonly reason: string } {
  switch (key) {
    case "cooldown": {
      const value = parseDuration(raw);
      if (value === undefined) return { ok: false, reason: `not a duration: ${raw.trim()}` };
      return { ok: true, settings: { ...settings, cooldownMs: value } };
    }
    case "vision":
    case "status": {
      const value = parseToggle(raw);
      if (value === undefined) return { ok: false, reason: `expected on or off, got: ${raw.trim()}` };
      return { ok: true, settings: key === "vision" ? { ...settings, preferVision: value } : { ...settings, statusLine: value } };
    }
    case "origins": {
      const { origins, rejected } = parseOrigins(raw);
      if (origins === undefined) return { ok: false, reason: `not an http(s) origin: ${rejected.join(", ")}` };
      return { ok: true, settings: { ...settings, excludedOrigins: origins } };
    }
    case "providers": {
      const providers = parseList(raw);
      const bad = providers.filter((provider) => !PROVIDER_ID.test(provider));
      if (bad.length > 0) return { ok: false, reason: `not a provider id: ${bad.join(", ")}` };
      return { ok: true, settings: { ...settings, excludedProviders: providers } };
    }
    case "models": {
      const { models, rejected } = parseAllowedModels(raw);
      if (models === undefined) return { ok: false, reason: `not provider/id: ${rejected.join(", ")}` };
      return { ok: true, settings: { ...settings, allowedModels: models } };
    }
  }
}

/** Read the settings the file holds. Unknown keys and bad values are reported, never guessed. */
export function parseSettings(text: string): ParsedSettings {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { settings: DEFAULT_SETTINGS, notes: ["the settings file is not valid JSON; defaults are in force"], applied: [] };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { settings: DEFAULT_SETTINGS, notes: ["the settings file is not a JSON object; defaults are in force"], applied: [] };
  }

  const record = raw as Record<string, unknown>;
  const notes: string[] = [];
  const applied: SettingKey[] = [];
  let settings = DEFAULT_SETTINGS;

  for (const [key, value] of Object.entries(record)) {
    const descriptor = SETTINGS.find((entry) => entry.key === key);
    if (!descriptor) {
      notes.push(`ignored unknown setting "${key}"`);
      continue;
    }
    // Every shape the writer produces is readable here, so a file this module
    // wrote round-trips: a toggle is a boolean or a word, a list is an array or
    // a comma separated string, a duration is a number or a string.
    const text =
      typeof value === "number"
        ? String(value)
        : typeof value === "string"
          ? value
          : typeof value === "boolean"
            ? value
              ? "on"
              : "off"
            : Array.isArray(value) && value.every((entry) => typeof entry === "string")
              ? value.join(", ")
              : undefined;
    if (text === undefined) {
      notes.push(`ignored "${key}": expected a number, a string, a boolean, or a list of strings`);
      continue;
    }
    const edited = editSetting(settings, descriptor.key, text);
    if (!edited.ok) {
      notes.push(`ignored "${key}": ${edited.reason}`);
      continue;
    }
    settings = edited.settings;
    applied.push(descriptor.key);
  }
  return { settings, notes, applied };
}

/** Copy one field from `source` onto `target`. */
function copyField(target: Settings, source: Settings, key: SettingKey): Settings {
  switch (key) {
    case "cooldown":
      return { ...target, cooldownMs: source.cooldownMs };
    case "vision":
      return { ...target, preferVision: source.preferVision };
    case "status":
      return { ...target, statusLine: source.statusLine };
    case "origins":
      return { ...target, excludedOrigins: source.excludedOrigins };
    case "providers":
      return { ...target, excludedProviders: source.excludedProviders };
    case "models":
      return { ...target, allowedModels: source.allowedModels };
  }
}

/**
 * The keys a project-local file may set. The rest decide where a request goes,
 * and a checked-out repository must not be able to redirect the chain or take a
 * provider out of it — the same boundary `pi-star-router` documents for its own
 * project file. A project may change how the router behaves towards the
 * operator (how long a failure is remembered, whether images matter, whether
 * the footer is drawn); it may not change who serves the request.
 */
export const PROJECT_KEYS: readonly SettingKey[] = ["cooldown", "vision", "status"];

export interface SettingsSources {
  /** Text of the global settings file, when it could be read. */
  readonly global?: string;
  /** Text of the project settings file, when the project is trusted and it exists. */
  readonly project?: string;
  readonly env?: Record<string, string | undefined>;
}

/**
 * The settings in force: defaults, then the global file, then the project file
 * for the keys a project may set, then the environment. Each environment
 * variable overrides the whole setting, so a wrong value there is reported and
 * the configured value stands rather than being thrown away.
 *
 * Only the keys a source actually named are merged. A project file that sets
 * `cooldown` must not reset `providers` on its way through.
 */
export function resolveSettings(sources: SettingsSources = {}): ParsedSettings {
  const env = sources.env ?? {};
  const fromGlobal: ParsedSettings =
    sources.global === undefined
      ? { settings: DEFAULT_SETTINGS, notes: [], applied: [] }
      : parseSettings(sources.global);

  const notes = [...fromGlobal.notes];
  const applied = [...fromGlobal.applied];
  let settings = fromGlobal.settings;

  if (sources.project !== undefined) {
    const parsed = parseSettings(sources.project);
    notes.push(...parsed.notes.map((note) => `project: ${note}`));
    for (const key of parsed.applied) {
      if (!PROJECT_KEYS.includes(key)) {
        notes.push(`ignored project setting "${key}": a project may not change where requests go`);
        continue;
      }
      settings = copyField(settings, parsed.settings, key);
      applied.push(key);
    }
  }

  for (const descriptor of SETTINGS) {
    const raw = env[descriptor.envVar];
    if (raw === undefined || raw.trim() === "") continue;
    const edited = editSetting(settings, descriptor.key, raw);
    if (!edited.ok) {
      notes.push(`ignored ${descriptor.envVar}: ${edited.reason}`);
      continue;
    }
    settings = edited.settings;
    applied.push(descriptor.key);
  }

  return { settings, notes, applied };
}

/** The file form: stable key order, one setting per line, no derived values. */
export function serializeSettings(settings: Settings): string {
  const body = {
    cooldown: settings.cooldownMs,
    vision: settings.preferVision,
    status: settings.statusLine,
    origins: [...settings.excludedOrigins],
    providers: [...settings.excludedProviders],
    models: [...settings.allowedModels],
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

/**
 * One line per setting, as the wizard and the report show them. A value an
 * environment variable is holding is marked, because that is the one source the
 * window cannot write: an edit there would be stored and then overridden.
 */
export function describeSettings(settings: Settings, env: Record<string, string | undefined> = {}): string[] {
  return SETTINGS.map((descriptor) => {
    const raw = env[descriptor.envVar];
    const fromEnv = raw !== undefined && raw.trim() !== "";
    return `${descriptor.label}: ${descriptor.value(settings)}${fromEnv ? " (env)" : ""}`;
  });
}

/** A subcommand, as the command's argument completion offers it. */
export interface Subcommand {
  readonly value: string;
  readonly description: string;
}

export const SUBCOMMANDS: readonly Subcommand[] = [
  { value: "settings", description: "Open the settings window" },
  { value: "set", description: "Set one value without the window: set <key> <value>" },
  { value: "reset", description: "Write the default settings" },
  { value: "next", description: "Take the current candidate out for one cooldown window" },
  { value: "reload", description: "Rebuild the candidate list after a score or credential change" },
];

/** Values worth offering for one setting, when it has a short list of them. */
const SUGGESTED_VALUES: Partial<Record<SettingKey, readonly string[]>> = {
  cooldown: ["5m", "15m", "1h", "300000", "off"],
  vision: ["on", "off"],
  status: ["on", "off"],
};

/**
 * Argument completions for `/aaii-router`. The subcommands come first, then the
 * setting keys after `set`, then the short list of values for the settings that
 * have one. A list setting (origins, providers) has no suggestions: its values
 * come from the operator's own configuration, not from this table.
 */
export function completionsFor(prefix: string): Subcommand[] {
  const trimmed = prefix.replace(/^\s+/, "");
  const words = trimmed.split(/\s+/);

  if (words[0] === "set") {
    const keyPrefix = words[1] ?? "";
    const matches = SETTINGS.filter((descriptor) => descriptor.key.startsWith(keyPrefix));
    if (words.length <= 2) {
      return matches.map((descriptor) => ({ value: `set ${descriptor.key} `, description: descriptor.help }));
    }
    const key = matches[0];
    if (key === undefined) return [];
    const typed = words[2] ?? "";
    return (SUGGESTED_VALUES[key.key] ?? [])
      .filter((value) => value.startsWith(typed))
      .map((value) => ({ value: `set ${key.key} ${value}`, description: key.label }));
  }

  return SUBCOMMANDS.filter((subcommand) => subcommand.value.startsWith(trimmed));
}

/** Where the settings are written to, when nothing overrides it. */
export const SETTINGS_FILE = "aaii-router.json";

/** A file's text, or `undefined` when it is absent or unreadable. */
export async function readSettingsFile(path: string): Promise<string | undefined> {
  return readFile(path, "utf8").catch(() => undefined);
}

export interface SettingsFiles {
  readonly global: string;
  /** The project file, only when the project is trusted. */
  readonly project?: string;
}

export async function loadSettings(
  files: SettingsFiles,
  env: Record<string, string | undefined> = {},
): Promise<ParsedSettings> {
  const [global, project] = await Promise.all([
    readSettingsFile(files.global),
    files.project === undefined ? undefined : readSettingsFile(files.project),
  ]);
  return resolveSettings({ global, project, env });
}

/**
 * Write the settings. The temporary name is a sibling in the same directory, so
 * the rename is atomic: a reader either sees the old file or the new one, never
 * a half-written one.
 */
export async function saveSettings(path: string, settings: Settings): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, serializeSettings(settings), "utf8");
  await rename(temp, path);
}
