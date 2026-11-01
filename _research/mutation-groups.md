# Mutation check — routing groups (aaii-router)

- 날짜: 2026-02-XX (worker mutation-check run)
- 방법: 원본 트리를 전혀 건드리지 않고 `%TEMP%` 사본(`mutation-hHoSsD/repo`, `.git` 제외)에서만 변이. 각 변이 후 전체 스위트를 돌리고 원복.
- 시험 명령: `PI_OFFLINE=1 PI_CODING_FALLBACK_FREE_REFRESH=off node --test */*.test.ts` (extensions/ 에서, node 내장 러너)
- 원본 기준(0단계): **280 pass / 0 fail** — 사본도 동일 → 동일성 확인 완료.
- 각 변이는 원복 후 다음 변이 진행. 사본은 보고서 작성 전 삭제 완료. `git status --short`로 원본 트리 불변 확인(작업 전 스냅샷과 동일).

## 결과 요약

| # | 변이 | 대상 | 결과 | 잡은 시험 |
|---|------|------|------|-----------|
| M1 | rotate 오프셋 +1 (`turns % n` → `(turns+1) % n`) | strategy.ts:83 | **kill** | strategy.test.ts (3 fail) |
| M2 | least-used 정렬 내림차순 | strategy.ts:112 | **kill** | strategy.test.ts `least-used serves the candidate with the fewest requests…` |
| M3 | manual pin 없음 강등 note 제거 | strategy.ts:66 | **kill** | strategy.test.ts `manual holds the session to the pinned models…` |
| M4 | free-first 티어 비교 제거 | strategy.ts:74 | **kill** | strategy.test.ts `free-first puts the free tier first…` |
| M5 | COOLDOWN_MAX_STRETCH 상한 제거 (`Math.min` 제거) | cooldown.ts:127 | **kill** | cooldown.test.ts `the stretch stops at 4 windows…` |
| M6 | 만료 창의 hits 재사용 (prune 된 맵 대신 원 맵에서 current 조회) | cooldown.ts:126 | **kill** | cooldown.test.ts `a failure after the window closed starts a fresh window…` |
| M7 | chooseTurnCandidate의 `affinity === "turn"` 분기 제거 | cooldown.ts:200 | **kill** | cooldown.test.ts + index.test.ts (2 fail) |
| M8 | parseGroup의 `aaii` 예약 거부 제거 | groups.ts:78 | **kill** | groups.test.ts + settings.test.ts (2 fail) |
| M9 | routingChanged groups 내용 비교 → 참조 비교 | settings.ts:482 | **kill** | index.test.ts `reset redirects…` + settings.test.ts (2 fail) |
| M10 | index.ts explain record 호출 6곳 주석화 | index.ts:814–876 | **kill** | index.test.ts `explain reports the last routing decision…` |
| M11 | candidatesForGroup tieOrder 정렬 제거 (filter만) | groups.ts:115 | **kill** | groups.test.ts `candidatesForGroup orders a family by the quota…` |
| E1 | 에스컬레이션 hits 카운트 동결 (`+1` 제거) | cooldown.ts:126 | **kill** | cooldown.test.ts (3 fail: window stretch / cap / describeCooldown) |
| E2 | group 이름 기본값 제거 (`` `${match} fallback` `` → `match`) | groups.ts:95 | **kill** | groups.test.ts + settings.test.ts (2 fail) |
| E3 | coolingDescriptions의 until 오름차순 정렬 제거 | **explain.ts:101** | **SURVIVE** | 없음 (280 pass) |
| E4 | stepForward의 전체-cooling 시 폴백 제거 (`?? rest[0]` 제거) | cooldown.ts:227 | **kill** | cooldown.test.ts `takes the next candidate anyway…` |
| E5 | preferred의 전체-cooling 시 head 폴백 제거 (`?? ordered[0]` 제거) | cooldown.ts:156 | **kill** | cooldown.test.ts `prefers the first candidate that is not cooling…` |
| E6 | pruneCooldowns가 만료 항목 유지 (`until > now` 조건 제거) | cooldown.ts:92 | **kill** | cooldown.test.ts (2 fail) |
| E7 | coolingLabels의 soonest-expiry 정렬 제거 | cooldown.ts:134 | **kill** | cooldown.test.ts `reports a window in words, soonest expiry first` |
| E8 | free-first의 label tiebreak 제거 (`localeCompare` → `return 0`) | **strategy.ts:77** | **SURVIVE** | 없음 (280 pass) |

**요약: 18개 변이 중 16 kill, 2 survive.**

## Survive 분석 — 무방비한 계약

### S1. explain.ts:101 — coolingDescriptions의 보고 순서 계약
```ts
return Object.entries(cooldowns)
  .filter(([label]) => inChain.has(label))
  .sort(([, a], [, b]) => a.until - b.until)   // ← 이 정렬을 지키는 시험이 없음
  .map(([label, entry]) => `${label} (${describeCooldown(entry, now)})`);
```
- 계약: `/aaii-router explain`의 cooling 목록은 **만료가 임박한 것부터** 표시된다(주석: "Cooling labels with their remaining windows"). 같은 파일의 `coolingLabels`(cooldown.ts:134)는 E7에서 kill로 보장되지만, explain.ts 쪽 사본은 시험이 없다.
- 무방비 이유: `index.test.ts`의 explain 시험이 cooling 항목이 1개이거나 삽입 순서가 우연히 정렬 순과 일치해서 순서 단정을 하지 않는 것으로 보임. `Object.entries`는 삽입 순서를 반환하므로 실패→재실패 순서가 뒤섞인 세션에서는 임박 순이 아닌 임의 순으로 보고될 수 있고, 어떤 시험도 잡지 못한다.

### S2. strategy.ts:77 — free-first의 label tiebreak 계약
```ts
if (scoreA !== scoreB) return scoreB - scoreA;
return a.label.localeCompare(b.label);   // ← 이 tiebreak를 지키는 시험이 없음
```
- 계약: 같은 티어에서 **점수까지 동점**인 후보는 label(=provider/id) 순으로 안정적으로 배치된다. `strategy.test.ts:37`의 fixture(`daily-low` 40 / `daily-high` 50)는 티어 내 점수가 달라 tiebreak에 도달하지 않음 — 테스트 이름("keeps score order inside a tier")이 주는 착각과 달리 label 동점 경로는 전혀 커버되지 않음.
- 무방비 이유: 동점일 때 `return 0`이면 stable sort가 들어온 순서(정책 순)를 유지하므로, 점수 스냅샷에 동점이 섞인 체인에서 free-first의 순서가 결정론적이지 않게(스냅샷/registry 순서 의존) 될 수 있고 시험은 통과한다.

## 원본 기준선 기록

- 원본(작업 트리, 커밋 전 상태)에서 동일 명령: 280 pass / 0 fail.
- 사본에서 0단계 재확인: 280 pass / 0 fail → 동일성 OK.
- 모든 변이 실험 후 사본 재검증(원복 확인): 280 pass / 0 fail.

## 사본/원본 위생

- 변이는 전부 `C:\Users\airgu\AppData\Local\Temp\mutation-hHoSsD\repo` 에서만 수행, 종료 후 디렉터리 삭제.
- `git status --short`(원본): 작업 시작 전과 동일 — 코드 파일 무변경. (본 보고서 `_research/mutation-groups.md` 추가만 있음.)
