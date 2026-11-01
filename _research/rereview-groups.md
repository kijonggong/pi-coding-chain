검증이 완료되었습니다. 쓰기 가능한 도구를 사용할 수 없으므로 아래 최종 응답에 전체 보고서를 작성했습니다 (런타임에서 `_research/rereview-groups.md`로 지속합니다).

---

# 재검토 보고 — Magpie routing 채택 기능 수정 라운드 (groups·strategy·affinity·explain·에스컬레이션)

작성일: 2026-10-31 · 독립 재검토(새 세션, 읽기 전용) · 판정 기준: `docs/engineering-standard.md`
입력: `docs/engineering-standard.md`, `_research/dispositions-groups.md`, `_research/mutation-groups.md`, WORKLOG §9, 소스 전문(index·strategy·groups·explain·settings·cooldown), 시험 7파일 중 5파일 전문, README(확장·최상위), `_research/routing-groups-design.md`

**판정: FINDINGS 7건 (차단 0 · 보완 필요 3 · 사소 4) — RE-REVIEW PASS (보완 필요 항목은 후속 시험·문서 정리 과제)**

작업자 보고 파일 `_research/fix-report-groups.md`와 WORKLOG가 참조하는 `_research/groups-impl-report.md`는 저장소에 존재하지 않았고(아래 Finding 3), 보고 대신 처분표·WORKLOG §9.8·실제 코드·시험을 직접 대조해 검증했다.

## Review

### 해소 확인된 항목 (처분표 "수정" 13항목 + 시험 보강 2건 — 전수 코드 대조)

1. **R-P0-1 + R-P2-1 (rotate retry 되감기) — 해소.** `extensions/aaii-router/index.ts:855-861`: retry 분기가 `stored.turns - 1`로 되감은 상태로 `applyStrategy(visionFirst, …)`를 재계산해 실패한 턴의 순서를 걷는다. 시험 연결 확인: `index.test.ts` "a retry walks the order the failed turn started from…"이 fresh turn이 **실제 반환한 state**(`first.state`)를 retry 입력으로 재주입하고, 되감기 없으면 offset 1로 one/a가 맨 뒤가 되어 `stepForward`가 `undefined`("chain exhausted")가 됨을 잡는다 — 실제 생산자→소비자 연결이며 변이에 민감하다. `strategy.test.ts` "rotate recomputed from the stored counter minus one…"이 단위 경계를 별도로 잠근다(중복이 아니라 경계가 다른 보강).
2. **C-2 (strategyName 완전 제거) — 해소.** `grep strategyName extensions/aaii-router/*.ts` → 0건(소스·시험·문서 모두; 잔존분은 WORKLOG·_research의 처분 기록뿐). 전략은 `index.ts:750-757` `groupStrategy(group, settings)`로 매 요청 결정되고 state는 카운터만 운반한다. 세션 중 전략 변경이 반영되는 동작 자체는 코드로 확인했으나 이를 잠그는 시험이 없다(Finding 2).
3. **R-P1-1 — 해소.** `index.ts:80` `import type { DecisionReason } from "./explain.ts";` 존재.
4. **R-P1-2 (groups 부분 거부 note) — 해소.** dialog 경로 `index.ts:470`(`for (const note of edited.notes ?? []) ctx.ui.notify(…, "warning")`)와 `set` 경로 `index.ts:645` 양쪽에 동일 보고가 있다. `set` 경로는 `index.test.ts` "set groups reports the entries it dropped…"가 잠근다(dialog 경로 미시험 — Finding 6).
5. **R-P2-2 — 해소.** `explain.ts:103-112` `consideredList(ordered, limit)` — 죽은 `chosen` 매개변수 소멸, `RoutingDecision`에 `when` 필드 없음, `recordDecision` 주석이 실제 동작("replacing whatever was there")과 일치.
6. **R-P2-3 — 해소.** `index.ts:664-678`: 등록 팩토리가 `parsed.settings.groups`를 그대로 등록, 재검증 루프·`registrationNotes` 소멸(grep 0건). `groups` 값은 항상 `parseGroupsValue`를 통과하므로 2.7 판단이 맞다.
7. **R-P2-4 (least-used 실제 응답자 집계) — 해소(코드).** `index.ts:790-805` `stick()`이 유일한 커밋 지점이고 fresh(`:884`)/continuation(`:827,830`)/retry(`:876`) 세 반환 경로 모두 `stick`을 통과하므로 실제 응답자가 `recordServed`로 섞인다. retry에서 least-used 재정렬은 실패한 응답자 1개의 카운트만 바꾸고 나머지 상대 순서를 보존하므로 실패한 턴의 순서와 일치한다(논리 확인). 단, 배선을 잠그는 통합 시험이 없다(Finding 1).
8. **R-P2-5 — 해소.** `strategy.ts:85-93` rotate 분기가 `rotate: starting at position N` note를 내고 `strategy.test.ts` "rotate announces the position…"이 잠근다. README("rotation" 조정 항목)·설계 §6과 일치.
9. **R-P2-6 — 해소.** `settings.ts:482-491`: groups를 `[id, match, name, strategy, affinity]` 튜플로 직렬화해 id 정렬 뒤 비교 — 키 순서 무관 내용 비교가 **구조적으로** 성립(객체 키 순서가 아닌 배열 요소 비교). M9 변이(참조 비교)는 index.test.ts "reset redirects… only when routing settings changed"(동일 내용·다른 참조 쓰기 후 stickiness 보존 단정)로 kill 유지.
10. **R-P2-7 — 해소.** index.ts에 `preferred` 미사용 import 없음, `containsImage`는 `index.ts:761`에서 1회 계산해 재사용.
11. **IL-TYP-301 — 해소.** `groups.ts:110-121` `const match = group.match; if (match === undefined) return …` — non-null 단언 소멸.
12. **IL-ARC-205 — 해소.** `settings.ts:24`가 `strategy.ts`의 `STRATEGIES`를 재사용, `groups.ts:18,63`도 동일 출처. `'least-used'` 리터럴은 소유자(`strategy.ts:25,94,116`)와 시험에만 존재.
13. **R-P2-8 + M-E3 + M-E8 — 해소.** `index.test.ts` per-group strategy/affinity override 2건(실제 route 경유, `requestOn`이 분기 state를 기록하는 실제 세션 이중 사용), `explain.test.ts` 정렬 시험(삽입 순서를 일부러 어그리고 기대값은 독립 리터럴), `strategy.test.ts` 전체 동률 fixture. E3(정렬 제거)·E8(tiebreak 제거) 변이가 이 시험들에서 각각 실패할 것을 코드 대조로 확인(실행 재현은 Finding/검증 한계 참조).

### 기각·부채 기록의 타당성

- **IL-IL-307 기각 — 타당.** `parseDuration`은 `undefined`를 반환하고 호출부(`editSetting` `settings.ts:277-279`)가 `ok:false` 이유로 보고한다. `settings.test.ts`가 이유 문구를 단정. "조용한 기본값" 아님.
- **IL-IL-301a 기각 — 타당.** `parseSettings` JSON catch가 note("not valid JSON; defaults are in force")와 함께 반환되고 `settings.test.ts:150-155`가 note·기본값을 단정. 조용한 대체가 아니라 보고된 강등.
- **IL-IL-301b 기각 — 타당.** `parseGroupsValue` catch가 `rejected`를 반환하고 `editSetting`이 `ok:false`로 전달(`settings.ts:354-356`), `settings.test.ts:308`이 단정.
- **IL-AI-101 기각 — 타당.** 고정 URL은 문서화된 기본값(LiteLLM 프록시 기본 제외, README "the LiteLLM proxy").
- **IL-PERF-102·IL-ARC-201 부채 기록 — 정확.** index.ts는 이번 변경으로 실제로 확장됐고(등록·명령·route 조율), "함수 단위 분할 보류·파일 분할은 별도 계획" 기록이 현실과 일치. 기존 코드 미변경 경계 표기도 정확.
- **C-3~C-8 기각/해소 — 코드로 재확인.** retry 상태 보존(`index.ts:876` + 주석), `takeHead` 소멸(strategy.ts에 부재), 비문자열 배열 coercion note(`settings.test.ts:297-303`), `readSettingsFile` ENOENT만 없음 처리·나머지 전파, env 루프가 공용 경로(`resolveSettings` 말미) — 모두 사실과 일치.

### 새 위반 검토 (수정이 끌어들인 것)

- **3절 덧대기**: routes.ts→groups.ts 대체는 깨끗하다(`routes.ts` 삭제 + 참조 0건 grep 확인). registration 재검증 제거도 덧대기가 아니라 제거다. 다만 explain.ts의 `coolingDescriptions`가 cooldown.ts `coolingLabels`의 filter+sort를 사본으로 둔다(Finding 5).
- **조용한 기본값**: retry 되감기의 `turns === undefined ? 0`은 `applyStrategy`의 기본값과 같은 규약이고 주석으로 이유가 있다 — 조용한 fallback 아님. dialog toggle 경로의 `edited.ok ? … : undefined`는 toggle 값이 항상 파싱 성공하므로 도달 불가(2.7상 허용).
- **시험 계약 완화**: settings.test.ts의 직렬화 키 목록 갱신은 계약 갱신이지 완화가 아니다(WORKLOG §9.4 주장과 일치). 새 7시험 모두 기대값을 구현에서 복사하지 않았다(독립 리터럴·fixture 파생). 다만 두 계약이 잠기지 않았다(Finding 1·2).
- **retry 되감기 경계**: `turns` 0·undefined·저장값 부재 — 아래 Finding 4.

## Findings

**Finding 1 — 보완 필요(P2): least-used의 recordServed 배선이 어떤 시험에도 잠기지 않음**
- 위치: `extensions/aaii-router/index.ts:795-803`(`stick` 내 `recordServed`) vs `extensions/aaii-router/strategy.test.ts:112-119`
- 위반 절: 2.9(시험은 실제 생산자·소비자를 잇는 최소한으로 — "어떤 관측으로 위반을 잡는지")
- 근거: R-P2-4의 코드 수정은 확인됐지만, `index.test.ts`에는 strategy `least-used`를 쓰는 시험이 없고(strategy.test.ts만 `recordServed`를 직접 호출), mutation 목록(M1~E8)에도 `index.ts`의 `recordServed` 호출 제거 변이가 없다. `stick`에서 `recordServed` 호출을 지워도 287시험은 모두 통과한다 — 즉 "fresh·continuation·retry가 실제 응답자를 센다"는 처분표의 수정 계약이 회귀에 무방비.
- 최소 수정: index.test.ts에 `strategy: "least-used"` 3-candidate fixture로 (a) fresh turn 후 `state.strategy.served`가 머리가 아닌 실제 응답자를 +1하는지, (b) cooling으로 머리가 밀린 뒤의 응답자가 세어지는지 1개 시험 추가(혹은 이 변이를 mutation 목록에 추가해 kill 확인).

**Finding 2 — 보완 필요(P2): "세션 중 전략 변경 즉시 반영"(C-2의 실제 계약)을 잠그는 시험 없음**
- 위치: `extensions/aaii-router/index.ts:751-753` vs `extensions/aaii-router/index.test.ts` 전체
- 위반 절: 2.9(계약 시험), 2.10(처분 "수정"의 시험 잠금 관례 — C-2는 "수정"으로 처분됐으나 시험 없음)
- 근거: strategyName 제거와 매-요청 `groupStrategy(group, settings)`는 코드로 확인했으나, `set strategy rotate` 후 다음 fresh turn이 회전하는 것을 단정하는 시험이 없다. state 우선 읽기로의 회귀(옛 C-2 결함)를 잡는 시험이 없다.
- 최소 수정: index.test.ts에 `set strategy rotate` → 두 번째 fresh turn의 후보가 바뀌는지 1개 시험 추가.

**Finding 3 — 보완 필요(P2): WORKLOG §9가 참조하는 구현 보고 파일이 저장소에 없음**
- 위치: `WORKLOG.md:177` "구현 보고 `_research/groups-impl-report.md`" — 파일 부재(`find **/*groups*report*.md` 0건). 재검토 지시서가 지정한 `_research/fix-report-groups.md`도 부재.
- 위반 절: 2.11(인계 위생 — 현재 추가·삭제·미처분 기록 위치를 남긴다), 4(보고 점검표)
- 근거: 처분 근거 문서가 참조하는 1차 산출물이 유실되면 다음 담당이 보고를 코드로 대조할 수 없다(이번 재검토에서 실제로 그 상황이 발생).
- 최소 수정: 보고서를 커밋에 포함하거나 참조를 실제 위치(세션 산출물 ID 등)로 갱신.

**Finding 4 — 사소(P2): retry 되감기에서 `turns: 0` 저장값이 음수 오프셋을 만드는 잠재 경로**
- 위치: `extensions/aaii-router/index.ts:858-859` `turns: stored.turns === undefined ? 0 : stored.turns - 1` → `strategy.ts:83-84` `turns % ordered.length`
- 근거: `stored.turns === 0`이면 `-1 % n === -1`(JS) → `slice(-1)`로 **반대 방향** 회전. 다만 이 코드는 `applyStrategy`가 항상 `turns+1(≥1)`을 저장하므로(`strategy.ts:88`) 현재 도달 불가 — 2.7상 방어 추가는 오히려 과잉 방어다. 세션 state를 손으로 만지거나 외부 도구가 쓰는 경우만 해당. 기록용 관찰로 남긴다(수정 불요).

**Finding 5 — 사소(P2): `coolingDescriptions`가 `coolingLabels`의 filter+sort(임박순 규칙)를 사본으로 둠**
- 위치: `extensions/aaii-router/explain.ts:100-107` vs `extensions/aaii-router/cooldown.ts:139-143`
- 위반 절: 2.4(같은 지식을 두 곳에 적지 않는다 — "soonest expiry first" 규칙이 2파일 2시험으로 분산)
- 근거: 1차 mutation의 S1 분석 자체가 "explain.ts 쪽 사본"으로 지칭했으나, 처분은 시험 보강(M-E3)만 하고 중복은 남겼다.
- 최소 수정: `coolingDescriptions`를 `coolingLabels`에서 파생(inChain 필터 후 entry 조회)하거나, 공유 helper로 통합. 동작 보존 리팩토링.

**Finding 6 — 사소(P2): 두 하위 경로의 시험 갭**
- (a) settings 창 dialog 경로의 groups 부분 거부 note(`index.ts:470`) — `set` 경로만 시험됨(`index.test.ts` "set groups reports…"). (b) `routingChanged`의 groups 키-순서 독립성 — 튜플 추출+정렬로 **구조적으로** 보장되고 내용 비교 자체는 M9 kill로 잠겨 있으며 `parseGroup`이 키 삽입 순서를 정규화하므로 실질 위험은 낮으나, "같은 groups를 키/배열 순서만 다르게 저장 → epoch 불변"을 직접 단정하는 시험은 없다.
- 위반 절: 2.9. 최소 수정: (a) dialog 경로 1시험, (b) settings.test.ts 1단정(선택).

**Finding 7 — 사소(P2, 보고 전용): `routingChanged`가 그룹 `name`을 비교에 포함 — 표시 전용 rename도 epoch를 올림**
- 위치: `extensions/aaii-router/settings.ts:486-488`
- 근거: name은 라우팅 대상에 영향이 없지만 `/model` 표시의 일부라 그룹 정의의 내용으로 보는 것은 방어 가능한 선택. 다만 name-only 변경이 `auto` 친화도의 기억 후보를 떨어뜨린다(stickiness 리셋). 문서에 이 효과가 없으므로 README 한 줄 추가 또는 name 비교 제외 중 결정만 필요.

## 시험 실행 명령 (감독자 실행 필요 — 본 리뷰는 셸을 쓸 수 없음)

```
PI_OFFLINE=1 PI_CODING_FALLBACK_FREE_REFRESH=off node --test extensions/*/*.test.ts
```
- 기대: 287 pass / 0 fail (WORKLOG §9.8 보고치 — 본 재검토는 실행 재현 없이 시험 코드의 kill 민감도를 정적 대조로 확인).
- 선택: Finding 1의 변이(`index.ts` `stick` 내 `recordServed` 호출 주석화)를 임시 사본에서 1회 실행해 현 시험 전량 통과(=무방비)를 재확인하면 Finding 1의 근거가 실행으로도 고정된다.

## 검사 안 한 영역

- **시험 실행 재현**: 287/287과 E3/E8 재-kill은 WORKLOG 보고 + 시험 코드의 정적 민감도 대조로만 검증했다(셸 미사용 제약).
- **Iron Laws 재실행 결과**(`_research/iron-laws-groups-after.json`)의 내용 미검증 — 처분표 인용만 확인.
- **주변 모듈 회귀 정밀 검토**: `candidates.ts`, `chain-order.ts`, `fallback-editor.ts`/`fallback-tui.ts`, `cooldown.test.ts` 전문, `quota-providers` — 이번 diff의 노면(seam) 밖이라 요약 수준만 확인.
- **라이브 Pi 세션 동작**(완료 정의 3~5단계: 실제 모델 호출·실물 증거) — 정적 재검토 범위 밖.

---

**최종 판정: FINDINGS 7건 (차단 0 · 보완 필요 3 · 사소 4) — RE-REVIEW PASS.**
처분표의 수정 13항목은 전부 코드에서 실제 해소를 확인했고 기각 5건·부채 2건의 근거도 타당하다. 남은 것은 (1) least-used 배선과 (2) 세션 중 전략 변경이라는 두 "수정" 계약을 잠그는 시험 2건과 (3) 유실된 작업자 보고 파일의 참조 정리다 — 모두 후속 소규모 수정으로 해소 가능하며 병합을 막을 수준은 아니다.