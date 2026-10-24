/** Operator pins override score order; exclusions win even over a pin. */
import type { Settings } from "./settings.ts";

export function applyChainSettings<T extends { readonly label: string }>(
  candidates: readonly T[],
  settings: Pick<Settings, "pinnedModels" | "excludedModels">,
): T[] {
  const excluded = new Set(settings.excludedModels);
  const kept = candidates.filter((candidate) => !excluded.has(candidate.label));
  const byLabel = new Map(kept.map((candidate) => [candidate.label, candidate]));
  const pinned: T[] = [];
  for (const label of settings.pinnedModels) {
    const candidate = byLabel.get(label);
    if (!candidate) continue;
    pinned.push(candidate);
    byLabel.delete(label);
  }
  return [...pinned, ...kept.filter((candidate) => byLabel.has(candidate.label))];
}
