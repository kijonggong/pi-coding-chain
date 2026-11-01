# 수정 보고 — groups 처분 기록 "수정" 항목 반영 (fix-report-groups)

작성일: 2026-10-31 · 처분 근거 `_research/dispositions-groups.md` (독립 리뷰 11건, 세션 산출물
`e433967b`의 내용은 처분표로 대입 — `review-groups-independent.md` 파일은 저장소에 없음) ·
정본 `docs/engineering-standard.md` 2.2·2.3·2.5·2.7·2.9 재독 완료.

수정 대상 파일(단일 writer 소유): `extensions/aaii-router/`의 index.ts·index.test.ts·
explain.ts·explain.test.ts(신설)·strategy.ts·strategy.test.ts·groups.ts·settings.ts + 루트
`WORKLOG.md`(§9). 그 외 파일은 문맥 읽기만. git 조작 없음(커밋·푸시 없음, `git status` 조회만).

## 처분 ID별 반영 내역

| ID | 지운 것 | 바꾼 것 / 남긴 것 |
|---|---|---|
| **R-P0-1 + R-P2-1** | retry가 fresh-turn 순서와 다른 순서를 걸던 경로(저장 state를 그대로 `applyStrategy`에 재주입 → rotate에서 실패 후보가 꼬리로 밀려 `stepForward` undefined) | retry 분기(index.ts)가 `strategy === "rotate"`일 때 `{...stored, turns: stored.turns - 1}`(저장값 없으면 0)로 되감은 상태로 순서를 재계산해 실패한 턴이 출발한 순서를 걷는다. 다른 전략은 턴 번호에 의존하지 않아 현재 전략으로 재계산해도 동일. 전략 note는 경로별로 붙이도록 분리해 retry의 explain이 재계산된 순서의 note를 보고 |
| **C-2** | `RouterState.strategyName` 필드·읽기(`parseStrategy(request.state?.strategyName) ?? …`)·쓰기(stick) 전부 소멸 | 전략은 매 요청 `groupStrategy(group, settings)`로 결정 — `/aaii-router set strategy`가 epoch bump와 함께 즉시 반영. continuation·retry의 전략 카운터 보존(`request.state?.strategy ?? …`)은 유지 |
| **R-P1-1** | — | `import type { DecisionReason } from "./explain.ts";` 추가 (index.ts) |
| **R-P1-2** | — | `editSettingDialog`(설정 창 dialog)와 `set` 경로 두 곳에서 `edited.notes`를 `ctx.ui.notify(…, "warning")`로 보고. settings.ts는 기존 `{ok, settings, notes}` 반환 그대로(수정 불필요) |
| **R-P2-2** | explain.ts `consideredList`의 미사용 `chosen` 매개변수, `RoutingDecision.when` 필드(소비자 0건 확인 후 필드째 제거), "for tests" 주석 | `consideredList(ordered, limit)` — index.ts 호출부도 함께 갱신. `lastDecision()` 주석을 "for the `explain` command to draw"로 교정. `when: now` 기록 호출도 제거 |
| **R-P2-3** | 등록 팩토리의 `parseGroup` 재검증 루프·`seen` 집합·`registrationNotes` 필드·보고서 라인의 `[...registrationNotes, …]` | `registeredGroups = [FULL_CHAIN, ...parsed.settings.groups]`로 단순화. 함께 죽은 미사용 import(`parseGroup`, `FULL_CHAIN_ID`)도 제거(2.3). 코디네이터 지시 오류 철회 항목 |
| **R-P2-4** | least-used가 fresh turn만 집계하던 구조 | `recordServed`를 `stick`(응답자 확정의 단일 커밋 지점)으로 옮겨 fresh·continuation·retry 모두 실제 응답자(candidate.label)를 센다. rotate의 turns는 retried.state로 그대로 보존 |
| **R-P2-5** | — | strategy.ts rotate 분기가 offset ≠ 0일 때 `rotate: starting at position N` note 반환. index.ts는 경로별로 note를 push하므로 추가 코드 없이 explain에 반영 — README·설계 §6 주장이 실제가 됨 |
| **R-P2-6** | `routingChanged`의 groups `JSON.stringify` 직접 비교 | [id, match, name, strategy, affinity] 튜플을 JSON 직렬화해 id 기준 정렬한 뒤 비교 — 키 순서가 다른 동일 내용은 "같음". 기존 M9 관련 시험(index.test.ts + settings.test.ts) 그대로 통과 |
| **R-P2-7** | index.ts 미사용 `preferred` import, `containsImage(request.messages)` 이중 계산 | `const withImage = settings.preferVision && containsImage(...)` 1회 계산 후 재사용 |
| **IL-TYP-301** | groups.ts `candidatesForGroup`의 `group.match!` non-null 단언 | `const match = group.match` 지역 변수 추출 + undefined 조기 반환으로 narrowing |
| **IL-ARC-205** | settings.ts `SUGGESTED_VALUES`의 strategy/affinity 하드코딩 나열, groups.ts 거부 문구의 하드코딩 나열 | `strategy: [...STRATEGIES]`(strategy.ts), `affinity: [...AFFINITIES]`(cooldown.ts)에서 파생; groups.ts `parseGroup`의 거부 reason도 `STRATEGIES.join(", ")`·`AFFINITIES.join(", ")`로 파생 — 문자열 단일 출처 |
| **R-P2-8 / M-E3 / M-E8** | strategy.test.ts의 "rotate only moves on a fresh turn" 재주입 전제 시험 | 아래 시험 보강 표 참조. 회전 단위 진행·wrap 단정("rotate starts the turn at a different candidate each turn…")은 그대로 남김 |

## 시험 보강 — 시험마다 지키는 계약

| 시험 (파일) | 지키는 계약 한 줄 |
|---|---|
| `a retry walks the order the failed turn started from, not the next turn's` (index.test.ts) | fresh turn의 **실제 반환 state를 그대로 retry 입력으로** 재주입(`requestOn`과 같은 생산자→소비자 연결)했을 때 rotate 그룹이 실패 후보 다음 후보로 넘어간다 — 수정 전에는 이 입력에서 "chain is exhausted"로 throw. retry가 회전 카운터를 보존하는 것(`{turns:1}`)도 함께 단정 |
| `rotate recomputed from the stored counter minus one repeats the failed turn's order` (strategy.test.ts) | 단위 경계: 저장 카운터 −1로 재계산하면 실패한 턴의 순서가 정확히 재현되고 카운터는 제자리 — index.test.ts가 경로를 잠그고 이것이 전략 모듈의 단위를 잠근다 |
| `rotate announces the position it starts from when it is not the head` (strategy.test.ts) | R-P2-5: 오프셋이 0이 아닐 때만 `rotate: starting at position N` note가 나온다 |
| `a group's own strategy rotates its route while the global order stays on the head` (index.test.ts) | 그룹의 per-group `strategy`가 route() 결과에 반영된다(전역 order·그룹 rotate → 그 그룹만 순환, 전체 체인은 선두 고정) |
| `a group's own affinity keeps the session where failure moved it…` (index.test.ts) | 그룹의 per-group `affinity`가 route() 결과에 반영된다(전역 turn·그룹 session → 실패가 옮겨놓은 후보에 머무름; 전역 상속 시 선두 복귀) |
| `set groups reports the entries it dropped and keeps the valid ones` (index.test.ts) | R-P1-2: `set groups`에 나쁜 항목 1 + 좋은 항목 1을 넣으면 거부 note가 경고 알림으로 나오고 좋은 항목은 파일에 생존한다 |
| `coolingDescriptions lists the windows about to expire first, in the chain only` (explain.test.ts, 신설) | 결정 기록의 cooling 목록은 만료 임박순(until 오름차순)이며 경로가 걷는 후보만 이름붙인다 — 삽입 순서를 일부러 어긋나게 둠 |
| `free-first breaks a full tie (same tier, same score) by label` (strategy.test.ts) | 티어·점수가 모두 동률일 때 free-first 순서는 label 순으로 고정된다(스냅샷 순서 의존 제거) |

## Mutation 재확인 (E3·E8)

방법: 원본 트리를 건드리지 않고 임시 사본(`/tmp/mutation-e3e8/repo`, `.git` 제외)에서만 변이.

| 변이 | 대상 | 결과 | 잡은 시험 |
|---|---|---|---|
| E3 재현: coolingDescriptions의 `.sort(([, a], [, b]) => a.until - b.until)` 제거 | explain.ts:100 | **kill** (0 pass / 1 fail) | explain.test.ts `coolingDescriptions lists the windows about to expire first…` |
| E8 재현: free-first label tiebreak `localeCompare` → `return 0` | strategy.ts:77 | **kill** (11 pass / 1 fail) | strategy.test.ts `free-first breaks a full tie (same tier, same score) by label` |

사본은 삭제 완료(`rm -rf /tmp/mutation-e3e8`), 원본 트리는 변이 없음(아래 검증으로 재확인).
이전 18변이 기록(16 kill / 2 survive)의 survive 2건이 모두 kill로 전환 — mutation 계층 18/18.

## 전체 시험·grep 결과

- `PI_OFFLINE=1 PI_CODING_FALLBACK_FREE_REFRESH=off node --test extensions/*/*.test.ts`
  → **287 tests / 287 pass / 0 fail** (이전 기준 280 + 신설 7: index.test.ts 4, explain.test.ts 1,
  strategy.test.ts 2)
- `grep -n "strategyName" extensions/aaii-router/*.ts` → **0건**
- `grep -n "registrationNotes" extensions/aaii-router/index.ts` → **0건**
- `grep -n "group.match!" extensions/aaii-router/*.ts` → 0건, `\.when\b` → 0건

## 4절 점검표

- [x] **바꾼 책임의 소유 모듈과 구조**: retry 순서 결정은 routeFor(index.ts)의 소유로 재계산을 그 자리에서,
      응답자 집계는 stick(같은 함수)의 단일 커밋 지점으로, 회전 note는 strategy.ts(전략 순서의 소유)에 둠.
      설정 창·`set`의 note 보고는 각 호출 지점(editSettingDialog·set 분기)에, groups 비교는
      routingChanged(settings.ts)에.
- [x] **더한 것 / 뺀 것**: 더한 것 — retry 되감기 재계산, rotate 오프셋 note, 경로별 전략 note push,
      note notify 2곳, 튜플 정규화 비교, 시험 7건 + explain.test.ts 신설. 뺀 것 — `strategyName`
      필드·읽기·쓰기, `RoutingDecision.when`, `consideredList`의 `chosen`, 등록 재검증 루프·
      `seen`·`registrationNotes`, 미사용 import(`preferred`, `parseGroup`, `FULL_CHAIN_ID`),
      재주입 전제 rotate 시험(실제 단정으로 교체). 호출 지점(index.ts 호출부·record) 모두 함께 고침.
- [x] **3절 형태를 쓴 곳**: 없음. 덧대는 경로 없이 원인 자리(index.ts retry 분기, settings.ts 비교)에서 수정.
- [x] **새 구조·정보의 실제 역할과 소비자**: rotate 오프셋 note의 소비자는 `/aaii-router explain` 독자;
      튜플 정규화의 소비자는 epoch bump 판정; note notify의 소비자는 설정 창·`set` 사용자.
- [x] **시험 계약과 mutation check**: 위 표 + E3/E8 재확인 kill.
- [x] **남긴 임시 코드**: 없음.
- [x] **동작 보존 / 의미 변경**: **의미 변경** — retry의 rotate 순서(결함 수정), strategyName 제거로
      설정 변경이 즉시 반영, least-used가 continuation/retry 응답자도 집계, rotate note 신설, groups
      비교 정규화(키 순서 무관), note 알림 신설. **동작 보존** — order 전략의 정책 순서, 쿨다운·친화도,
      continuation stickiness, M9이 잡는 참조 비교 변이 검출력.
- [x] **처분 기록 위치**: `_research/dispositions-groups.md`(처분표), 본 보고서, `WORKLOG.md` §9.8.

## 문서 갱신

- `WORKLOG.md` §9: §9.2에 처분 라운드에서 뺀 것(strategyName·재검증 루프) 기록, §9.3 갱신(재검증 제거
  확정), §9.4의 strategy.test.ts 계약 갱신, §9.7의 전략 적용 시점 문구 갱신, §9.8 신설(처분 요약 수정
  13/기각 5/부채 2, mutation 18변이 → E3/E8 kill 전환, 재검증 287/287 + grep 0건).
- `_research/routing-groups-design.md`(문서 정합성 항목의 승인 범위): §3 rotate 행의 strategyName·retry
  문구를 되감기 재계산으로 교정, §9의 routingChanged JSON 비교 문구를 정규화 비교로, 재검증 "제거 후보"
  문구를 "제거 완료"로 갱신. least-used "실제로 응답한 후보를 센다"는 기존 문구가 이번 수정으로 실제가 됨.
- README는 소유 목록 밖이라 수정하지 않음 — 전략 변경이 즉시 반영된다는 서술이 README에 있다면 다음
  문서 레인에서 확인 대상(현재 README에 strategyName 직접 언급은 없음을 grep으로 확인).

## 남긴 임시 코드

없음.
