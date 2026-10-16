/**
 * Whether the OpenRouter allowlist is in force, and where that answer came
 * from.
 *
 * Pure where it matters: parsing, the precedence order, the display text and
 * the argument completions are functions of their inputs, so a test can check
 * them and the command cannot disagree with the extension about what `off`
 * means. File I/O is confined to the two functions at the bottom, and neither
 * imports the Pi SDK.
 *
 * Precedence is **environment > file > default**, and the default is `on`,
 * which is what an install that has never run the command gets: the extension
 * behaved that way before it had a switch, and adding a switch must not change
 * anyone's catalog as a side effect of upgrading.
 *
 * The switch is not a settings file for the extension's own knobs; it exists
 * because the allowlist replaces a provider's whole catalog, and the operator
 * needs a way back to Pi's own composition without editing `settings.json` or
 * uninstalling the package.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** `on` or `off` for this run. Overrides the file. */
export const STATE_ENV = "PI_OPENROUTER_FILTER";

/** Point the state file somewhere else. */
export const STATE_PATH_ENV = "PI_OPENROUTER_FILTER_STATE";

/** The file name under the agent directory. */
export const STATE_FILE = "openrouter-catalog-filter.json";

/** The allowlist is on unless something says otherwise. */
export const DEFAULT_ENABLED = true;

const ON = new Set(["on", "true", "yes", "1", "enable", "enabled"]);
const OFF = new Set(["off", "false", "no", "0", "disable", "disabled"]);

/** `on`/`off`, in the spellings a shell, a file or a person would use. */
export function parseSwitch(text: string): boolean | undefined {
  const trimmed = text.trim().toLowerCase();
  if (ON.has(trimmed)) return true;
  if (OFF.has(trimmed)) return false;
  return undefined;
}

/** Where the answer came from, for the report. */
export type StateSource = "env" | "file" | "default";

export interface ResolvedState {
  readonly enabled: boolean;
  readonly source: StateSource;
  /**
   * What a source said that could not be used. A value that was ignored is
   * reported rather than replaced quietly, because a catalog narrowed by a
   * setting nobody chose is worse than one that says which line it skipped.
   */
  readonly notes: readonly string[];
}

export interface StateSources {
  /** Text of the state file, when it could be read. */
  readonly file?: string;
  readonly env?: Record<string, string | undefined>;
}

/**
 * Read the file the way the writer produces it: an object with a boolean
 * `enabled`. A missing key, a wrong shape or a broken file leaves the field
 * unknown (`undefined`), which is what lets the caller tell "off" from "no
 * opinion" instead of treating every unreadable file as `off`.
 */
export function parseState(text: string): { readonly enabled?: boolean; readonly notes: readonly string[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { notes: ["the state file is not valid JSON; its setting was ignored"] };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { notes: ["the state file is not a JSON object; its setting was ignored"] };
  }

  const value = (raw as Record<string, unknown>).enabled;
  if (value === undefined) return { notes: ["the state file has no \"enabled\" field; its setting was ignored"] };
  if (typeof value === "boolean") return { enabled: value, notes: [] };
  const parsed = typeof value === "string" ? parseSwitch(value) : undefined;
  if (parsed === undefined) {
    return { notes: [`ignored "enabled": expected true or false, got ${JSON.stringify(value)}`] };
  }
  return { enabled: parsed, notes: [] };
}

export function resolveState(sources: StateSources = {}): ResolvedState {
  const env = sources.env ?? {};
  const notes: string[] = [];

  let enabled = DEFAULT_ENABLED;
  let source: StateSource = "default";

  if (sources.file !== undefined) {
    const parsed = parseState(sources.file);
    notes.push(...parsed.notes);
    if (parsed.enabled !== undefined) {
      enabled = parsed.enabled;
      source = "file";
    }
  }

  const raw = env[STATE_ENV];
  if (raw !== undefined && raw.trim() !== "") {
    const parsed = parseSwitch(raw);
    if (parsed === undefined) {
      notes.push(`ignored ${STATE_ENV}: expected on or off, got ${JSON.stringify(raw)}`);
    } else {
      enabled = parsed;
      source = "env";
    }
  }

  return { enabled, source, notes };
}

/** The file form. One field, so a hand edit is a one-line change. */
export function serializeState(enabled: boolean): string {
  return `${JSON.stringify({ enabled }, null, 2)}\n`;
}

/** A subcommand, as the command's argument completion offers it. */
export interface Subcommand {
  readonly value: string;
  readonly description: string;
}

export const SUBCOMMANDS: readonly Subcommand[] = [
  { value: "status", description: "Show whether the allowlist is in force, and what it is keeping" },
  { value: "on", description: "Narrow the OpenRouter catalog to the allowlist again" },
  { value: "off", description: "Stop overriding the catalog: Pi composes OpenRouter itself" },
  { value: "reload", description: "Fetch the catalog again and reapply the current state" },
  { value: "list", description: "Print the model ids the allowlist keeps" },
];

/** Argument completions for the command, in the order the subcommands are listed. */
export function completionsFor(prefix: string): Subcommand[] {
  const trimmed = prefix.replace(/^\s+/, "").toLowerCase();
  return SUBCOMMANDS.filter((subcommand) => subcommand.value.startsWith(trimmed));
}

/** One line for a report: the state, plus which source decided it. */
export function describeState(state: ResolvedState, path: string): string {
  const label = state.enabled ? "on" : "off";
  const why =
    state.source === "env" ? `${STATE_ENV} says so` : state.source === "file" ? `from ${path}` : "default";
  return `allowlist ${label} (${why})`;
}

/** A byte-for-byte sibling write, so a reader never sees half a file. */
export async function saveState(path: string, enabled: boolean): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp`;
  await writeFile(temp, serializeState(enabled), "utf8");
  await rename(temp, path);
}

/** The resolved state, reading the file if it is there. */
export async function loadState(
  path: string,
  env: Record<string, string | undefined> = {},
): Promise<ResolvedState> {
  const file = await readFile(path, "utf8").catch(() => undefined);
  return resolveState({ file, env });
}
