# AAII fallback 변이 검사 보고서

## 범위와 방법

`docs/engineering-standard.md` 2.9의 “핵심 새 시험은 규칙을 일부러 틀리게 바꿨을 때 실패하는지 한 번 확인하고 원복한다”를 적용했다. 제품 코드와 시험은 수정하지 않았으며, 원본 저장소에는 이 보고서만 추가했다. 전체 저장소를 `.git`만 제외하고 `robocopy /E /XD .git`으로 OS 임시 디렉터리에 복사했다.

- 작업일: 2026-10-24.
- 복사본: `C:/Users/airgu/AppData/Local/Temp/aaii-mutation-485edfec-3a5b-44c0-8ea4-78303d95a886` (검사 완료 후 삭제).
- 기준 명령: `node --test extensions/aaii-router/*.test.ts extensions/coding-fallback/chain.test.ts extensions/coding-fallback/free-models.test.ts`.
- 원본 및 복사본 최초 결과: 각각 **111 tests / 109 pass / 0 fail / 2 skipped**. 두 skip은 `PI_CODING_FALLBACK_LIVE_TESTS=1`이 필요한 실제 사용자 설정 검사다.
- 각 변이는 한 소스 줄만 바꿨다. `node --test --test-reporter=tap <관련 시험 파일>`로 해당 파일 전체를 실행하고 종료 코드와 `not ok` 시험명을 기록한 뒤, `finally`에서 그 파일의 원래 바이트를 복구했다. 여러 변이를 누적하지 않았다.
- 모든 변이 원복 후 복사본에서 기준 명령을 다시 실행한 결과도 **111 tests / 109 pass / 0 fail / 2 skipped**였다.
- 결과: **34개 변이 중 killed 28개, survived 6개**. 살아남은 변이는 아래에서 누락 계약으로 별도 기록한다. 컴파일 오류만으로 죽은 변이는 없고 모든 killed 행에 실제 실패 시험명이 있다.

## 규칙별 결과

아래 경로의 줄 번호는 복사 시점 기준이다. `A`는 `extensions/aaii-router/`, `C`는 `extensions/coding-fallback/`이다. 각 행에 적은 시험 파일 하나만 실행했으며, 실패명은 TAP이 출력한 이름 그대로다.

| 규칙 및 소스·시험 | 변이 (before → after) | 실패 시험명 | killed/survived |
|---|---|---|---|
| M01 1 제외가 핀보다 우선<br>`A/chain-order.ts:10`<br>시험 `A/chain-order.test.ts` | `!excluded.has(candidate.label)` → `true` | model exclusions override pins and leave other models from the same provider eligible | killed |
| M02 1 핀의 설정 순서<br>`A/chain-order.ts:13`<br>시험 `A/chain-order.test.ts` | `for (const label of settings.pinnedModels)` → `for (const label of [...settings.pinnedModels].reverse())` | 없음 (종료 코드 0) | **survived** |
| M03 1 알 수 없는 핀 무시<br>`A/chain-order.ts:15`<br>시험 `A/chain-order.test.ts` | `if (!candidate) continue;` → `if (!candidate) throw new Error("unknown pin");` | pins lead in configured order, missing and repeated pins are ignored, and remaining score order survives<br>model exclusions override pins and leave other models from the same provider eligible | killed |
| M04 2 moveUp 위 행까지 핀<br>`A/fallback-editor.ts:99`<br>시험 `A/fallback-editor.test.ts` | `index <= to ?` → `(key === "moveUp" ? index === to : index <= to) ?` | navigation clamps and J/K reorder while pinning every row needed to preserve the order | killed |
| M05 2 moveDown 위 행까지 핀<br>`A/fallback-editor.ts:99`<br>시험 `A/fallback-editor.test.ts` | `index <= to ?` → `(key === "moveDown" ? index === to : index <= to) ?` | navigation clamps and J/K reorder while pinning every row needed to preserve the order | killed |
| M06 2 d 두 번 확인<br>`A/fallback-editor.ts:111`<br>시험 `A/fallback-editor.test.ts` | `if (!state.armed &#124;&#124; state.message === DISCARD)` → `if (false)` | delete requires two taps, removes missing rows, and other keys disarm it<br>dirty cancel requires consecutive cancel taps and cannot confirm delete<br>pin on a missing row explains double-delete without changing the draft | killed |
| M07 2 다른 키로 d 해제<br>`A/fallback-editor.ts:71`<br>시험 `A/fallback-editor.test.ts` | `armed: false, message: undefined` → `armed: draft.armed, message: draft.message` | delete requires two taps, removes missing rows, and other keys disarm it<br>dirty cancel requires consecutive cancel taps and cannot confirm delete<br>pin on a missing row explains double-delete without changing the draft | killed |
| M08 2 핀 없는 행 d 비무장<br>`A/fallback-editor.ts:110`<br>시험 `A/fallback-editor.test.ts` | `if (!row.pinned && !row.missing)` → `if (false)` | delete on an unpinned row stays clean and never arms | killed |
| M09 2 dirty q 두 번 확인<br>`A/fallback-editor.ts:88`<br>시험 `A/fallback-editor.test.ts` | `if (!state.dirty &#124;&#124; (state.armed && state.message === DISCARD))` → `if (true)` | dirty cancel requires consecutive cancel taps and cannot confirm delete | killed |
| M10 2 mutation 후 missing 재계산<br>`A/fallback-editor.ts:77`<br>시험 `A/fallback-editor.test.ts` | `missing: entry.pinned && !current.has(entry.label)` → `missing: entry.missing` | pinning absent exclusions and reordering recompute missing, and delete leaves no ghost | killed |
| M11 2 preview 제외 행 제거<br>`A/fallback-editor.ts:134`<br>시험 `A/fallback-editor.test.ts` | `!row.excluded && !row.missing` → `!row.missing` | pipelinePreview omits excluded rows and truncates to the requested width | killed |
| M12 2 preview missing 행 제거<br>`A/fallback-editor.ts:134`<br>시험 `A/fallback-editor.test.ts` | `!row.excluded && !row.missing` → `!row.excluded` | pipelinePreview skips missing pins as the request chain does | killed |
| M13 2 excludedModels 순서 유지<br>`A/fallback-editor.ts:129`<br>시험 `A/fallback-editor.test.ts` | `excludedModels: [...settings.excludedModels.filter((label) => excluded.has(label)), ...[...excluded].filter((label) => !settings.excludedModels.includes(label))]` → `excludedModels: [...excluded]` | editorSettings retains existing exclusion order and appends new exclusions | killed |
| M14 3 label 슬래시 필수<br>`A/settings.ts:251`<br>시험 `A/settings.test.ts` | `!/^[^\s/]+\/\S+$/.test(label)` → `!/^[^\s/]+\/?\S+$/.test(label)` | model labels require both provider and id, deduplicate, and allow nested model ids | killed |
| M15 3 label 공백 금지<br>`A/settings.ts:251`<br>시험 `A/settings.test.ts` | `!/^[^\s/]+\/\S+$/.test(label)` → `!/^[^/]+\/.+$/.test(label)` | model labels reject internal whitespace through edits, files and environment | killed |
| M16 3 PROJECT_KEYS pinned 제외<br>`A/settings.ts:339`<br>시험 `A/settings.test.ts` | `["cooldown", "vision", "status"];` → `["cooldown", "vision", "status", "pinned"];` | project files cannot change pins or model exclusions and older files need no migration | killed |
| M17 3 PROJECT_KEYS models 제외<br>`A/settings.ts:339`<br>시험 `A/settings.test.ts` | `["cooldown", "vision", "status"];` → `["cooldown", "vision", "status", "models"];` | project files cannot change pins or model exclusions and older files need no migration | killed |
| M18 4 epoch 다르면 기억 무시<br>`A/index.ts:195`<br>시험 `A/fallback-tui.test.ts` | `const epochValid = stateEpoch === undefined &#124;&#124; stateEpoch === currentEpoch;` → `const epochValid = true;` | Finding 1 (stickiness): chooseTurnCandidate ignores remembered label when epoch changes | killed |
| M19 4 settings-window epoch bump<br>`A/index.ts:476`<br>시험 `A/fallback-tui.test.ts` | `bumpChainEpoch();` → `void 0;` | settings window invalidates stickiness for changed chain lists and reset only | killed |
| M20 4 fallback save epoch bump<br>`A/index.ts:537`<br>시험 `A/fallback-tui.test.ts` | `bumpChainEpoch();` → `void 0;` | 없음 (종료 코드 0) | **survived** |
| M21 4 set epoch bump<br>`A/index.ts:676`<br>시험 `A/fallback-tui.test.ts` | `bumpChainEpoch();` → `void 0;` | 없음 (종료 코드 0) | **survived** |
| M22 4 reset epoch bump<br>`A/index.ts:699`<br>시험 `A/fallback-tui.test.ts` | `bumpChainEpoch();` → `void 0;` | 없음 (종료 코드 0) | **survived** |
| M23 5 done은 저장 성공 후<br>`A/fallback-tui.ts:202`<br>시험 `A/fallback-tui.test.ts` | `this.options.onSave(nextSettings).then(` → `this.finish(nextSettings); this.options.onSave(nextSettings).then(` | pending saves request a render and show saving while ignoring further keys<br>Finding 2: onSave failure keeps editor open with error message and prevents double-save | killed |
| M24 5 실패시 draft 유지<br>`A/fallback-tui.ts:209`<br>시험 `A/fallback-tui.test.ts` | `const message = error instanceof Error ? error.message : String(error);` → `this.state = initialEditorState(this.options.candidates, this.options.settings); const message = error instanceof Error ? error.message : String(error);` | Finding 2: onSave failure keeps editor open with error message and prevents double-save | killed |
| M25 5 render escape 보존<br>`A/fallback-tui.ts:228`<br>시험 `A/fallback-tui.test.ts` | `render(width: number): string[] {` → `render(width: number): string[] { this.flushEscape();` | render leaves a pending escape available for the next arrow chunk | killed |
| M26 5 narrow 배지 label 앞<br>`A/fallback-tui.ts:319`<br>시험 `A/fallback-tui.test.ts` | `if (isNarrow && shortTags.length > 0)` → `if (false)` | a pinned badge survives a long label at width 16<br>Finding 5: below 30 columns shows compact footer and short row badges [P]/[X]/[!] | killed |
| M27 5 env 경고<br>`A/fallback-tui.ts:247`<br>시험 `A/fallback-tui.test.ts` | `this.options.heldEnvVars && this.options.heldEnvVars.length > 0` → `false` | Finding 3: heldEnvVars displays warning on header and status line on open | killed |
| M28 6 chain fixture 바깥 텍스트 보존<br>`C/chain.ts:572`<br>시험 `C/chain.test.ts` | `const text = next.join(eol);` → `const text = next.join(eol) + "# mutation";` | an order change is reported against the whole chain, not its tail<br>leaves everything outside the two generated blocks untouched | killed |
| M29 6 free fixture 기존 entry 내용 보존<br>`C/chain.ts:572`<br>시험 `C/free-models.test.ts` | `const text = next.join(eol);` → `const text = next.join(eol).replace("    api_key: os.environ/NVIDIA_API_KEY", "    api_key: os.environ/BROKEN_KEY");` | 없음 (종료 코드 0) | **survived** |
| M30 6 free fixture 기존 model_name 보존<br>`C/chain.ts:572`<br>시험 `C/free-models.test.ts` | `const text = next.join(eol);` → `const text = next.join(eol).replace("- model_name: code-5-nvidia-model-x", "- model_name: code-5-broken");` | a free model not in model_list is added as a generated group<br>adding a free model is idempotent<br>a full config accepts a generated group without disturbing its own entries | killed |
| M31 1 핀 선두 순서 역전<br>`A/chain-order.ts:16`<br>시험 `A/chain-order.test.ts` | `pinned.push(candidate);` → `pinned.unshift(candidate);` | pins lead in configured order, missing and repeated pins are ignored, and remaining score order survives | killed |
| M32 3 label 빈 provider 금지<br>`A/settings.ts:251`<br>시험 `A/settings.test.ts` | `!/^[^\s/]+\/\S+$/.test(label)` → `!/^[^\s/]*\/\S+$/.test(label)` | model labels require both provider and id, deduplicate, and allow nested model ids | killed |
| M33 3 label 빈 id 금지<br>`A/settings.ts:251`<br>시험 `A/settings.test.ts` | `!/^[^\s/]+\/\S+$/.test(label)` → `!/^[^\s/]+\/\S*$/.test(label)` | model labels require both provider and id, deduplicate, and allow nested model ids | killed |
| M34 6 free fixture router tail 보존<br>`C/chain.ts:572`<br>시험 `C/free-models.test.ts` | `const text = next.join(eol);` → `const text = next.join(eol).replace("  request_timeout: 120", "  request_timeout: 999");` | 없음 (종료 코드 0) | **survived** |

## Survivors와 누락 계약

1. **M02 — 핀 입력 순서를 역순으로 순회해도 통과.** 기존 첫 시험 입력은 `[c, missing, a, c]`여서 뒤집어도 유효 핀의 첫 등장 순서가 `[c, a]`로 같다. 따라서 서로 다른 두 핀의 순서를 일반적으로 보장하지 못한다. 중복 없는 `[c, a]` 등 비대칭 입력과 literal `[c, a, b, d]` 출력이 필요하다. 같은 규칙의 M31(`push` → `unshift`)은 죽었으나 M02의 입력 맹점을 상쇄하지는 않는다.
2. **M20 — fallback 편집기 저장 후 `bumpChainEpoch()` 제거.** 저장 결과를 소비하는 실제 명령 경로와 다음 요청의 재선택을 잇는 검증이 없다. 순수 선택 함수와 TUI 자체 저장 시험은 통과하지만 저장 후 예전 세션 기억을 버리는 계약은 확인하지 못한다.
3. **M21 — `set`의 `bumpChainEpoch()` 제거.** `/aaii-router set pinned ...` 및 `set models ...`가 기존 세션 기억을 무효화하고 새 체인을 사용한다는 명령 통합 계약이 빠졌다. 이 한 호출은 두 키에 공통이므로 둘 다 보호되지 않는다.
4. **M22 — 명령 `reset`의 `bumpChainEpoch()` 제거.** settings 창의 Reset 시험은 별도 경로다. `/aaii-router reset` 성공 후 기존 기억 대신 기본 체인으로 선택한다는 계약이 빠졌다.
5. **M29 — 기존 NVIDIA 항목의 `api_key`를 `BROKEN_KEY`로 바꿔도 free-models 시험 전체 통과.** `a full config accepts a generated group without disturbing its own entries`의 helper는 기존 `model_name` 목록만 비교한다. 기존 항목의 `litellm_params`, URL, 키, 주석 등 내용 보존을 확인하지 않는다. M30의 이름 훼손은 실패하므로 이름 보존만 검출한다는 차이가 확인됐다.
6. **M34 — free-model fixture의 `request_timeout: 120`을 `999`로 바꿔도 통과.** 생성 그룹 추가 시 `model_list` 바깥 router 설정까지 보존한다는 계약이 빠졌다. chain fixture의 별도 invariant는 M28의 바깥 텍스트 추가를 잡지만, free snapshot을 함께 넣는 생산자·소비자 경로의 보존 계약을 대신 검증하지는 않는다.

Survivor는 위 변이에 대한 검출력 공백이며 정상 코드에 같은 결함이 있다는 뜻은 아니다. 이번 작업은 읽기 전용 검토이므로 누락 시험을 추가하지 않았다.

## 2.9 관점의 과명세·구현 결합 후보

- **`pending saves request a render and show saving while ignoring further keys` (`fallback-tui.test.ts`)의 `savingRenders === 1`.** 화면 갱신 요청의 정확한 호출 횟수는 구현 세부다. 저장 중 표시가 보이고 완료가 지연되는 관측을 유지하면서 “적어도 갱신 요청이 있었다” 수준으로 바꿀 후보다. 반면 `attempts === 1`은 저장 중 중복 입력이 추가 쓰기를 만들지 않는 외부 부작용 계약이므로 단순 호출 횟수라는 이유로 삭제할 대상이 아니다.
- **`settings window invalidates stickiness for changed chain lists and reset only`의 `currentChainEpoch() === before + 1`.** 실제 다음 요청의 후보 선택 대신 내부 버전 카운터의 정확한 증분을 고정한다. 변경된 체인의 머리와 다른 기억 후보를 마련하고 명령 실행 전후 선택으로 무효화 계약을 확인하는 편이 강하다. M20–M22는 이 시험이 다른 명령 경로를 덮지 못함을 보여준다.
- **`declares one spec per chain` (`chain.test.ts`)의 `CHAINS.length === 2` 및 내부 spec 배열 단정.** 공개 alias로 생성되는 실제 설정을 확인하는 시험과 달리 내부 구성 개수·배치를 고정한다. alias 지원 자체는 계약이므로 생성 결과 시험으로 옮겨 중복 여부를 검토할 후보다.
- **`a fresh install has every setting at its default` (`settings.test.ts`)의 `DEFAULT_SETTINGS.cooldownMs === DEFAULT_COOLDOWN_MS`, `resolveSettings({})` 기대값으로 `DEFAULT_SETTINGS` 재사용.** 두 생산 상수가 함께 잘못 바뀌면 놓친다. 문서화된 기본값 계약은 독립 literal로 확인해야 한다. `DEFAULT_SETTINGS`를 입력 fixture의 바탕으로 쓰는 행위 전체가 문제라는 뜻은 아니다.
- **`keeps a failure for the window, then forgets it` (`cooldown.test.ts`)에서 `DEFAULT_COOLDOWN_MS`를 입력과 만료 기대값 양쪽에 사용.** 주입한 기간을 그대로 적용한다는 계약에는 적합하지만 실제 기본 기간의 올바름을 증명하지는 못한다. 기본값 검증으로 해석한다면 독립 literal이 필요하다.
- **TUI 첫 렌더·compact badge 시험의 공백 수, footer 전체 문자열, 폭 30 경계 고정.** 배지의 가시성, cancel 안내, 폭 제한은 사용자 계약이다. 반면 모든 공백·문구·내부 breakpoint까지 요구사항으로 확정된 것인지 확인할 후보다. 특히 배지가 긴 label 뒤에서 잘리는 오류를 잡는 M26 검출력은 보존해야 한다.
- **`pins lead ...`의 `ordered[0] === candidates[2]`.** 후보의 순서·필드 보존과 별개로 객체 동일성까지 고정한다. 소비자가 참조 동일성을 의존한다는 근거가 없다면 값 기반 계약으로 충분한지 검토할 후보다.

이 목록은 삭제 지시가 아닌 근거 있는 재검토 후보 목록이다. 소스 텍스트를 읽어 정규식으로 코드 모양 자체를 단정하는 시험은 이번 대상 파일에서 발견하지 않았다. fixture에서 생성 블록을 제외한 원래 바이트 보존을 확인하는 것은 실제 파일 쓰기 계약이므로 과검증으로 분류하지 않았다.

## 변경·검증 경계

추가한 것은 이 보고서뿐이며 제품 코드·시험의 추가 또는 삭제는 없다. 임시 변이와 실행 스크립트는 모두 임시 복사본에만 두고 원복한 뒤 복사본을 삭제했다. 3절의 wrapper·우회 경로를 제품에 추가하지 않았고, 남긴 임시 코드도 없다. 실제 사용자 LiteLLM 설정·네트워크·Pi UI 세션은 실행하지 않았으므로 이 보고서는 로컬 Node 계약 시험의 검출력만 다룬다.
