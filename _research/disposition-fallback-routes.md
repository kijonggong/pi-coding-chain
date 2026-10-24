# Dispositions — `fallback` virtual provider (aaii/deepseek/glm-5.3-flash routes)

Date: 2026-10-24. Scope: `git status` at close — modified `extensions/aaii-router/{index.ts,index.test.ts,candidates.ts,test-support.ts,README.md}`, root `README.md`, `extensions/quota-providers/README.md`; new `extensions/aaii-router/{routes.ts,routes.test.ts}`.

## Iron Laws

- `iron-laws-fallback-routes.json` (first run), `-after.json`, `-final.json`, `-final2.json`. scan_status `complete` each time.
- TYP-301 non-null assertion in `routes.ts` → **수정** (destructure `family`).
- ARC-201 file/function-length LOWs in `index.ts` → **부채 기록**: pre-existing shape (717-line module, long command handler); line shifts, not new debt. `chain.ts` ARC-201 hit in the first diff was a line-move false positive (empty `git diff` for that file).
- Everything else: pre-existing findings in files this change did not touch → **범위 밖** (unchanged files, no diff).

## Independent review #1 (GLM-5.3-Flash, fresh session) → dispositions

1. MEDIUM header id `fallback/glm-5.3` in index.ts → **수정**.
2. MEDIUM glm matching test used hypothetical `glm-5-3` key → **수정** (real `glm-5-3-flash`, `:free` tier suffix included as match, non-flash base excluded).
3. MEDIUM `route.provider ?? PROVIDER` (nonexistent property) in test → **수정** (`${PROVIDER}/${route.id}`).
4. MEDIUM `/aaii-router next` full-chain-head fallback → **수정**: `branchSelection(ctx)` (state entry + later `model_change`), `next` derives ordered list from the session's route.
5. LOW footer cooling count over the whole map → **수정**: `publishStatus` counts cooling among the route's `ordered` only.
6. LOW pendingCooldowns cross-route semantics undocumented → **수정**: doc comment on `pendingCooldowns` (entry is per-model, inert-but-consumed cross-route; `next` reads the session's route).
7. LOW two "full chain" discriminators → **수정**: `routeTag` discriminates on `family === undefined`, same as the error wording.
8. LOW comparator duplication → **수정**: `candidates.ts` exports `candidateOrder`/`tieOrder`; `buildCandidates` and `candidatesForRoute` share them.

## Re-review #2 (GLM-5.3-Flash, new session) → dispositions

- Finding 4 PARTIAL: state recorded then later `model_change` to another route still returned the stale state → **수정**: `branchSelection` returns `{routeId}` without state when a later `model_change` differs from the state's route; new test drives a `model_change` entry through the harness branch.
- MEDIUM `routes.ts:6` header still said `fallback/glm-5.3` → **수정**.
- LOW `model_change` path untested → **수정**: covered by the same test (field names `provider`/`modelId` confirmed against `session-manager.d.ts` ModelChangeEntry).

## Mutation checks (2.9)

- Token-boundary rule removed → glm family test fails; restored.
- Tier comparator inverted → 2 tests fail (routes + index family order); restored.

## Verification state

- `node --test extensions/*/*.test.ts` → 256/256 pass (was 254 before the change; +2 net new tests, several extended).
- Final Iron Laws diff vs previous run: zero new rule+file findings.
- Grep sweeps (try/catch-import, abs paths, silent defaults, `as unknown as`, skip/xfail): clean.
- 완료 정의: 소스·빌드 ✓ (Node type-stripping), 대역 통합 ✓ (module harness runs the real modules), 실물 증거 **미충족** — a live session picking `fallback/deepseek-v4.1-flash` and answering has not been run (spends a request). `pi --list-models fallback` showing the three ids is the one-command check.
