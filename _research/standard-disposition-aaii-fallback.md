# 정본 검증 처분 기록 — aaii-router fallback 편집기 · coding-fallback 시험 이식성

정본: `docs/engineering-standard.md`. 범위 정정(사용자 지시): Iron Laws(2.10-1)와 MATLAB 관련 항목은 제외.

입력:
- 독립 리뷰(opencode, 구현 비참여): `_research/standard-review-aaii-fallback.md` — F1–F14, VERDICT fix-first
- mutation check(codex, 임시 사본): `_research/mutation-check-aaii-fallback.md` — 34개 중 survivor 6개(M02, M20, M21, M22, M29, M34)
- 코디네이터 자체 점검(리뷰어에게 전달하지 않음): C1–C5

처분은 "수정" 또는 "근거 있는 기각"이다. 범위 밖(이번 세션 이전의 미커밋 작업)인 것은 2.8 scope discipline에 따라 "부채 기록"으로 남긴다.

## 확인한 사실 (처분 근거)

- `pi-tui`의 `terminal.js:151` `setupStdinBuffer()`가 `StdinBuffer`로 stdin을 **완전한 시퀀스 단위**로 잘라 컴포넌트에 넘긴다
  (`stdin-buffer.d.ts:1-13`). 컴포넌트가 받는 `data`는 이미 조립된 시퀀스다.
- `pi-tui`의 `matchesKey`/`parseKey`(`keys.d.ts:165-166`)는 legacy 시퀀스와 Kitty 키보드 프로토콜을 모두 해석한다.
  `extensions/coding-fallback/picker.ts`는 이미 이것과 `getKeybindings()`를 쓴다.
- 따라서 `fallback-tui.ts`의 50ms escape 버퍼와 `ESCAPE_SEQUENCES`는 SDK가 이미 맡은 책임을 다시 구현한 것이다
  (2.3 parallel implementation, 3절 "사후 보정: timeout"). 이 버퍼는 앞선 리뷰 H7을 보고 **코디네이터가 지시해 넣은 것**이다
  — 지시 단계의 오류로 기록한다(2.11 Lava Flow 방지: 다음 담당이 원래 설계로 오인하지 않게).

## 처분표

| ID | 출처 | 정본 | 요지 | 처분 | 담당 |
|---|---|---|---|---|---|
| F1 | 리뷰 | 2.4, 3-1 | 편집기 미리보기·행 정렬이 `applyChainSettings`와 별도로 순서 규칙을 재구현 | **수정** — 순서 규칙 하나를 라우팅과 편집기가 함께 쓴다 | B |
| F2 + C5 | 리뷰·자체 | 2.3, 2.6, 3 | `keyFor` raw 매칭 + escape 버퍼가 SDK `StdinBuffer`/`matchesKey`를 중복; Kitty 프로토콜 미지원 | **수정** — 키 해석을 셸로 옮겨 SDK `matchesKey`/`getKeybindings` 사용, 버퍼·시퀀스표·관련 시험 삭제 | B |
| F3 + C2 | 리뷰·자체 | 2.4, 2.7 | "체인이 바뀌었는가" 판단이 경로마다 다르고, `chainKeys`가 `PROJECT_KEYS`의 지식을 하드코딩 | **수정** — settings.ts에 단일 판정 하나(라우팅 키는 `SETTING_KEYS` − `PROJECT_KEYS`에서 도출), 모든 쓰기 경로가 사용, 변경 시에만 무효화 | A |
| F4 | 리뷰 | 2.9, 3-2 | `candidates.test.ts`가 `stepForward`를 cooldown 시험과 중복 단정 | **부채 기록** — 이번 세션 이전 작업(범위 밖). 다음 작업에서 삭제 | — |
| F5 | 리뷰 | 2.11, 2.9 | 시험 이름에 "Finding N"/"H7" 리뷰 번호 | **수정** — 계약을 드러내는 이름으로 | B |
| F6 + C4 | 리뷰·자체 | 2.1 | index/epoch 시험이 TUI 컴포넌트 시험 파일에 있음 | **수정** — `index.test.ts`로 이동(A 작성), TUI 파일에서 삭제(B) | A, B |
| F7 | 리뷰 | 2.4 | `tier >= 99` 매직 넘버 | **부채 기록** — 이번 세션 이전 코드(범위 밖), 현재 값 일치로 실패 없음 | — |
| F8 | 리뷰 | 2.7, 2.9 | 도달 불가 중복 후보 입력 시험, `ORIGINAL_ORDER ??` 죽은 폴백 | **수정** — 이번 세션 코드이므로 부채로 미루지 않고 삭제 | B |
| F9 | 리뷰·mutation | 2.9 | `savingRenders === 1` 호출 횟수 단정 | **수정** — "저장 중 표시가 보인다"만 관측, `attempts === 1`은 유지 | B |
| F10 + C1 | 리뷰·자체 | 2.3, 2.9, 3(skip·환경 변수 스위치) | fixture 시험이 대체한 라이브 설정 시험이 env 게이트+skip으로 남음 | **수정(삭제)** — 리뷰도 "제거해도 검출력 손실 없음". 리뷰의 "진단용 유지" 대안은 기각: 기계 종속 진단은 시험이 아니라 사람이 돌리는 확인이며, 게이트에 기여하지 않는 시험은 3절 형태다. 이 게이트는 코디네이터가 지시한 것 | C |
| F11 + M20–M22 | 리뷰·mutation | 2.9 | `fallback` 커맨드→저장→다음 요청, `set`, `reset`의 무효화를 잇는 시험 없음 | **수정** — 실제 확장을 등록해 명령을 실행하고 다음 `route()`가 고른 후보(내부 카운터 아님)를 관측 | A |
| F12 | 리뷰 | 2.4 | "no eligible model" 메시지·guard 두 벌 | **수정** — 이번 세션이 만든 중복. 하나로 | A |
| F13 + C3 | 리뷰·자체 | 2.5, 3(시험 전용 hook) | `currentChainEpoch`는 시험만 소비, `bumpChainEpoch` export 소비자 없음 | **수정** — export 제거, 시험은 행동으로 관측(F11). `SETTING_KEYS`는 F3에서 실제 소비자가 생김 | A |
| F14 | 리뷰 | 2.9 | 라벨 규칙을 edit/file/env 세 경로에서 검사 | **근거 있는 기각** — 세 경로는 서로 다른 신뢰 경계(대화형 입력·파일·환경)이고, 각 경로가 검증을 `editSetting`에 위임한다는 사실 자체가 계약이다. 시험에 그 목적을 한 줄 적는다 | A |
| M02 | mutation | 2.9 | 핀 순서 역순 순회가 생존(시험 입력이 대칭) | **수정** — 비대칭 입력·literal 기대값 | A |
| M29, M34 | mutation | 2.9 | free-models 경로가 기존 항목 내용·`model_list` 밖 설정 보존을 확인 안 함 | **수정** — fixture 시험이 생성 블록 밖 원문 보존을 확인(chain.test.ts의 방식과 같게) | C |
| mut-1 | mutation | 2.9 | `pins lead`의 객체 동일성 단정 | **수정** — 값 기반 | A |
| mut-2 | mutation | 2.9 | 기본값 기대값을 제품 상수로 비교(`DEFAULT_SETTINGS`, `DEFAULT_COOLDOWN_MS`) | **부채 기록** — 이번 세션 이전 시험(범위 밖) | — |
| mut-3 | mutation | 2.9 | `CHAINS.length === 2` 내부 구성 개수 단정 | **부채 기록** — 이번 세션 이전 시험(범위 밖) | — |
| mut-4 | mutation | 2.9 | TUI 렌더의 공백·문구 전체 고정 | **수정** — 계약(배지 가시성, save/cancel 안내, 폭 제한)만 단정 | B |

## 담당과 소유 파일 (겹치지 않음)

- **A (codex)**: `settings.ts`, `settings.test.ts`, `chain-order.ts`, `chain-order.test.ts`, `index.ts`, 새 `index.test.ts`
- **B (agy)**: `fallback-editor.ts`, `fallback-editor.test.ts`, `fallback-tui.ts`, `fallback-tui.test.ts`, `README.md`
- **C (pi)**: `extensions/coding-fallback/chain.test.ts`, `free-models.test.ts`
- 수정 뒤 독립 재리뷰: opencode(구현 비참여 유지)

## 부채 기록 (이번에 처리하지 않음, 2.8)

- F4: `candidates.test.ts:132-149` 중복 시험 삭제
- F7: `index.ts:328` `99` → `TIER_UNKNOWN`
- mut-2: `settings.test.ts`, `cooldown.test.ts`의 기본값 기대값을 독립 literal로
- mut-3: `chain.test.ts` "declares one spec per chain"을 생성 결과 시험으로

## 1차 수정 결과 확인 (코디네이터)

- A(codex): 확인 완료. `settings.ts:335` `routingChanged` 하나(`SETTING_KEYS` − `PROJECT_KEYS`에서 도출)를 설정 창·편집기 저장·`set`·`reset`
  네 경로가 사용. `chainKeys`·시험 전용 export 삭제. `index.test.ts`가 실제 확장으로 다음 `route()` 선택을 관측.
- C(pi): 확인 완료. coding-fallback 101 pass / 0 skip, `LIVE_TESTS`·`LIVE_CONFIG`·`homedir` 흔적 없음.
- B(agy): 시험은 통과(aaii-router 88/88)하나 **정본 위반 2건을 새로 만듦** → 2차 수정(B2)으로 처분.

| ID | 정본 | 위치 | 요지 | 처분 |
|---|---|---|---|---|
| B2-1 | 3절(호환·우회 shim, 사후 보정 fallback 기본값), 2.7(silent fallback), 2.4(하드코딩), 2.3(parallel implementation) | `fallback-tui.ts:34-70`, `fallback-tui.test.ts:36-80` | SDK import를 `try/catch`로 감싸고, 실패 시 **개발 PC의 절대 경로**(`file:///C:/Users/airgu/.pi/agent/install/releases/1.4.0/...`)로 재시도, 그것도 실패하면 손으로 쓴 `matchesKey` 사본으로 조용히 대체. 시험 대역도 같은 절대 경로로 실제 SDK를 읽어 기계 종속 | **수정** — `picker.ts`와 같은 정적 import. 시험은 `picker.test.ts`처럼 외부 경계에만 단순한 stub 패키지. Kitty 프로토콜 해석은 SDK 책임이므로 시험이 주장하지 않고 남은 검증 경계로 기록 |
| B2-2 | 2.2(감쌌다가 즉시 풀기), 2.4, F1 미해결 | `fallback-editor.ts:38-50` | `orderedRows`가 자체 정렬 후 행을 `as unknown as Candidate[]`로 바꿔 `applyChainSettings`에 넣고 다시 `as unknown as EditorRow[]`로 되돌림. 순서 규칙이 여전히 두 곳 | **수정** — `applyChainSettings`를 `{ label }`에 대해 제네릭으로 만들어 행을 그대로 넘기고, 편집기 쪽 자체 정렬 삭제 |

## 2차 수정(B2) 결과 확인 (코디네이터)

- B2-1, B2-2 확인 완료: aaii-router 89 pass / 0 fail / 0 skip, coding-fallback·openrouter-catalog-filter 109 pass / 0 skip.
  `fallback-tui.ts`는 `picker.ts`와 같은 정적 import, `extensions/`에 `airgu`·`releases/1.4.0` 없음,
  `applyChainSettings<T extends { label }>` 제네릭으로 행을 직접 전달, SDK stub은 `test-support.ts` 한 곳.
- 시험 파일의 `as unknown as Theme`/`ExtensionCommandContext`는 외부 경계 대역의 형 맞춤이므로 위반 아님(근거 있는 기각).

| ID | 정본 | 위치 | 요지 | 처분 |
|---|---|---|---|---|
| B3 | 3절(shim, fallback 기본값), 2.7(silent fallback) | `index.ts:95-105` | 1차 수정 중 `index.test.ts`를 돌리려고 원래 정적 import(`getAgentDir`, `VIRTUAL_MODEL_STATE_ENTRY`)를 `try/catch` 동적 import로 바꾸고, 실패 시 `getAgentDir`가 **현재 작업 디렉터리**로 조용히 대체. SDK 로드 실패 시 설정 파일이 엉뚱한 곳에 써질 수 있음. `test-support.ts` 경계가 생겨 더는 필요 없음 | **수정** — 원래 정적 import로 복원 |

## 3차 수정(B3) 결과 확인 (코디네이터)

- B3 확인 완료: `index.ts:96` 정적 import 복원, `process.cwd()` 대체 경로 삭제. aaii-router 90 pass / 0 skip,
  나머지 109 pass / 0 skip.
- 남은 `catch` 4곳 점검: `settings.ts:171`(URL 파싱 실패 → `undefined`, 호출자가 거부 사유로 보고), `settings.ts:263`(JSON 파싱
  실패 → note로 보고)은 실패를 드러내므로 근거 있는 기각. `index.ts:336`, `index.ts:724`(상태 줄 UI 호출 실패 무시)는
  이번 세션 이전 코드 → **부채 기록**(2.7 관점 재검토 후보).

## 독립 재리뷰 처분 (`_research/standard-rereview-aaii-fallback.md`, opencode, VERDICT fix-first)

재리뷰 판정: 처분표 "수정" 항목은 **모두 resolved**. F14 기각에 동의. 새 지적 NF1–NF7, F4·F7·mut-2·mut-3 근거 재검토 요청.

**범위 근거 정정**: 이 세션 시작 시점의 `git status`에 `candidates.test.ts`, `index.ts`, `chain.test.ts` 등이 이미 `M`(미커밋 수정)으로
있었으므로 "이번 세션 이전 작업"이라는 사실 자체는 맞다. 그러나 같은 미커밋 변경 집합으로 함께 커밋될 예정이고 고치는
비용이 작은 것은 "범위 밖"을 이유로 미루지 않는다. 그래서 F4(=NF1)와 F7(=NF3)은 **부채 → 수정**으로 바꾼다.

| ID | 정본 | 처분 | 근거 |
|---|---|---|---|
| NF1 (=F4) | 2.9, 3-2 | **수정** | `candidates.test.ts:132-149`의 `stepForward` 단정 삭제(소유는 `cooldown.test.ts`) |
| NF2 | 2.7, 2.9 | **수정** | 설정 목록 중복 라벨은 `parseList`·`editSetting`·`editorSettings` 어느 경로로도 생산되지 않음. `fallback-editor.test.ts:26-38`의 중복 입력만 제거하고 중첩 안정성 단정은 유지 |
| NF3 (=F7) | 2.4 | **수정** | `index.ts:307` `99` → `TIER_UNKNOWN` |
| NF4 | 2.4, 3-1 | **수정(문구)** | 미리보기는 체인 설정(핀·제외)이 만든 순서이고, 요청별 이미지 조정(`orderForRequest`)은 포함하지 않는다고 정확히 쓴다. 동작 변경 없음 |
| NF5, mut-2, mut-3 | 2.9 | **부채 기록(근거 재기술)** | 해당 단정은 이번 세션 시작 전 미커밋 작업에서 온 기존 시험이고, 이번 변경의 계약(핀·제외·편집기)과 무관한 기본값·체인 개수 시험이다. 2.8 변경 범위에 따라 별도 정리 작업으로 넘김 |
| NF6 | 2.9 | **수정** | `fallback-tui.test.ts:343,352`의 `setTimeout(10)` 대기를 promise 직접 대기로 교체 |
| NF7 | 2.4 | **부채 기록** | 폭 자르기 두 곳은 소비자가 다르고(미리보기 문자열 계약 vs 셸 렌더 클램프) 검출력이 있음. 리뷰 판정과 같음 |
| SDK `k`/`K` 우려(3.1) | 2.9 | **근거 있는 기각** | 실제 `pi-tui` `matchesKey`로 직접 확인: `"K"`·Kitty `\x1b[107;2u` → `shift+k`만, `"k"`·Kitty `\x1b[107u` → `k`만 일치. 검사 순서로 인한 오인 없음. (실제 SDK 키 파싱의 **실물 증거**로 기록) |

## 최종 확인 (`_research/standard-final-check-aaii-fallback.md`, opencode, VERDICT ship)

- NF1·NF2·NF3·NF4·NF6 모두 resolved. 마지막 수정에서 새로 생긴 수정 필수 위반 없음. 190 pass / 0 fail / 0 skip
  (aaii-router 89 + coding-fallback 101; NF1 삭제분 1건 감소와 일치).
- 리뷰어가 정정을 요구한 기록 두 가지를 그대로 반영한다.
  - **NF5 범위**: "기본값·체인 개수 시험"은 실제보다 좁은 요약이다. 제품 목록(`SETTINGS.map`)에서 기대값을 가져오는
    자동완성·applied 키 시험(`settings.test.ts:274`, `:295`)도 남아 있고, 그 목록에는 체인 키도 들어 있다. 따라서
    "핀·제외와 무관"은 NF5 전체에 해당하지 않는다. 부채 범위를 이 단정들까지 넓혀 기록한다.
  - **상태 줄 `catch`의 출처**: `index.ts:337`, `:725`가 "이번 세션 이전 코드"라는 말은 독립 확인된 사실이 아니다.
    HEAD에는 이 코드가 없고, 세션 시작 시점의 `M` 표시는 개별 줄이 그때 있었다는 증거가 아니다. 부채로 남기는
    처분은 유지하되, 출처는 "확인 안 됨"으로 고친다.

## 부채 목록 (최종)

| 항목 | 위치 | 정본 | 남긴 이유 |
|---|---|---|---|
| NF5 / mut-2 | `settings.test.ts:39-40`, `:274`, `:295`; `cooldown.test.ts:78-83` | 2.9 | 기대값을 제품 상수·목록에서 가져옴. 독립 literal로 바꾸는 별도 정리 작업 |
| mut-3 | `coding-fallback/chain.test.ts:293-296` | 2.9 | `CHAINS.length === 2` 내부 구성 고정. 생성 결과 시험으로 이관 |
| NF7 | `fallback-tui.ts:78-91`, `fallback-editor.ts:147-158` | 2.4 | 폭 자르기 두 곳(소비자·검출력 다름) |
| 상태 줄 `catch` | `index.ts:337`, `:725` | 2.7 | 상태 UI 오류를 무시함. 출처 확인 안 됨, 2.7 재검토 후보 |

## 이번 정본 검증에서 더한 것 / 뺀 것 (2.11)

- **더한 것**: `docs/engineering-standard.md`(정본), `aaii-router/index.test.ts`(실제 확장으로 다음 요청 선택 관측),
  `aaii-router/test-support.ts`(SDK 대역 한 곳), `settings.ts`의 `routingChanged`, `applyChainSettings`의 제네릭화,
  free-models 시험의 생성 블록 밖 원문 보존 단정.
- **뺀 것**: 50ms escape 버퍼·`ESCAPE_SEQUENCES`·`flushEscape`(SDK `StdinBuffer`와 중복), `fallback-editor.ts`의 `keyFor`
  (SDK `matchesKey`/`getKeybindings`로 대체), SDK import `try/catch`·개발 PC 절대 경로·손으로 쓴 `matchesKey` 사본
  (`fallback-tui.ts`), `index.ts`의 SDK import `try/catch`와 `process.cwd()` 대체, `index.ts`의 손으로 쓴 `chainKeys`,
  시험 전용 export(`currentChainEpoch`, `bumpChainEpoch` 공개), 편집기의 별도 정렬과 `as unknown as` 왕복,
  라이브 설정 시험 2건과 `PI_CODING_FALLBACK_LIVE_TESTS`, `candidates.test.ts`의 `stepForward` 중복 시험,
  도달 불가 입력 시험, `setTimeout(10)` 대기, 리뷰 번호가 붙은 시험 이름.
- **코디네이터 지시 오류 (Lava Flow 방지)**: 라이브 시험 env 게이트와 50ms escape 버퍼는 앞선 라운드에서 코디네이터가
  지시해 넣었다. 둘 다 이번 검증에서 정본 위반으로 판정되어 삭제했다.
- **남긴 임시 코드**: 없음.
- **동작 보존 vs 의미 변경**: 의미 변경 두 가지 — (1) 키 해석이 SDK 바인딩을 따름(설정한 취소 키·Kitty 프로토콜 지원),
  (2) 편집기 저장·`set`·`reset`·설정 창은 라우팅 키가 실제로 바뀐 경우에만 세션 고정 모델을 무효화함(이전에는 편집기
  저장과 `reset`이 항상 무효화). 나머지는 동작 보존.

## 2.10 완료 정의 (Iron Laws·MATLAB 제외, 네 단계)

1. **소스·import·빌드**: 충족 — 세 확장 198 pass / 0 fail / 0 skip(코디네이터 실행).
2. **대역 통합**: 충족 — 대역은 SDK(`test-support.ts`)·테마·`ctx.ui`·임시 디렉터리 파일 I/O에만 있고, `index.test.ts`가
   실제 명령 핸들러·편집기·`saveSettings`를 거쳐 다음 `route()`의 선택을 관측.
3. **사용 가능한 실물 증거**: 일부 — 실제 `pi-tui` `matchesKey`의 `k`/`K`·legacy·Kitty 해석을 직접 실행해 확인.
   실제 Pi 터미널에서 `/aaii-router fallback`을 열어 저장하고 다음 요청이 새 순서로 가는 세션 증거는 없음.
4. **실물 준비 완료**: 미충족 — 3번의 세션 증거가 필요.

## 커밋 전 정리 (사용자 승인 범위만)

- **삭제**: `_research/nf-worker-{full-tests.log,mutation-results.md,report.md}`(작업자가 맡은 범위 밖에서 남긴 로그. 내용은
  완료 보고와 이 문서에 이미 있음), `_research/.tmp/`(10-14 ExpLabs API 응답. 비밀 없음), `_research/Freebuff2API/`
  (`Quorinex/Freebuff2API` 클론. 로컬 변경·미푸시 커밋·stash 없음을 확인 후 삭제), `.zwork/`(10-13 에이전트 실행 기록).
- **삭제**: `quota-providers/catalog.test.ts`의 "the live LiteLLM config's targets … accounted for". C1과 같은 3절 형태
  (기계 종속 + skip)이고, 이 PC에 설정 파일이 없어 이미 skip되고 있었다. fixture로 옮기면 제품 코드가 아니라 시험 안의
  비교 로직만 확인하게 되어 2.9의 "검증을 위한 검증"이 된다. 그래서 대체 시험은 만들지 않았다. 카탈로그와 실제 설정의
  일치 여부가 운영상 필요하면 시험이 아니라 제품 명령으로 넣는다(현재 요구 없음, 2.5). 함께 쓰이지 않게 된
  `readFile`·`homedir`·`join`·`readModelEntries` import와 `LIVE_CONFIG`도 삭제. quota-providers 7 pass / 0 skip.
- **커밋하지 않고 남김**(사용자가 대체 표시를 선택하지 않음): `_research/aaii-fallback-tui-contract.md`(지운 `keyFor`·escape
  처리를 계약으로 설명하므로 표시 없이 커밋하면 오해 소지), `_research/review-aaii-fallback-{model,tui,verify}.md`(정본 이전
  1차 리뷰), 이 세션 전 조사 문서 3개(`aaii-score-source.md`, `freebuff2api-security-review.md`, `litellm-runtime-baseline.md`).

## 리뷰 처분 기록 위치 (4절 마지막 항목)

- 독립 리뷰: `_research/standard-review-aaii-fallback.md` → 이 문서의 처분표
- mutation check: `_research/mutation-check-aaii-fallback.md` → 이 문서의 처분표
- 독립 재리뷰: `_research/standard-rereview-aaii-fallback.md` → 「독립 재리뷰 처분」
- 최종 확인: `_research/standard-final-check-aaii-fallback.md` → 「최종 확인」
- Iron Laws·GPT Pro 리뷰: 사용자 지시로 이번 검증에서 제외(Iron Laws). GPT Pro 리뷰는 기존 대화로 받는 항목이라 받지 않았음.
