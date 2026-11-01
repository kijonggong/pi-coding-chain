검토일: 2026-10-31 · 1차 독립 리뷰 (구현 미참여, 읽기 전용)
원문: 세션 산출물 e433967b — 코디네이터가 저장(리뷰어 세션에 쓰기 도구 없음)

# 독립 코드 리뷰 — Magpie routing 채택 기능 접붙이기 (groups·strategy·affinity·explain·에스컬레이션)

검토일: 2026-10-31 · 검토자: 구현 미참여 독립 리뷰어 (읽기 전용)
대상: 작업 트리의 커밋되지 않은 변경 전체
기준: docs/engineering-standard.md (절 번호로 인용) · 설계: _research/routing-groups-design.md

## 총평

구조 방향은 설계대로다: routes.ts가 groups.ts로 흡수·삭제되었고(2.3 준수, 소스 참조 0건
확인), 전략은 candidates.ts의 정렬 정책 위에서만 작동하며(단일 출처 유지), 설정 3출처
병합·검증·라운드트립과 구형 세션 state 호환은 시험으로 확인된다. 그러나 **rotate 전략의
retry 경로에 체인을 잘못 소진시키는 기능 결함(P0)**이 있고, 대화형 설정 경로에서
groups 부분 거부 note가 삼켜지며(2.7), 한 곳에서 타입 참조가 깨져 있다.

## 지적 목록

### P0-1 (차단) rotate 전략에서 retry가 남은 후보가 있는데도 "chain exhausted"로 실패
- 위치: extensions/aaii-router/index.ts:784-788, 849-869 · strategy.ts:78-89
- 인용:
  - index.ts:784 `const distributed = applyStrategy(visionFirst, { strategy, pinnedModels: settings.pinnedModels, state: request.state?.strategy });`
  - index.ts:855 `const candidate = stepForward(ordered, next, failedLabel, now);`
  - index.ts:858-862 `throw new Error(`[${tag}] ${failedLabel} failed and the chain is exhausted after ${ordered.length} candidates`)`
  - index.ts:866-867 주석: "The rotation state is not advanced here: a retry keeps the turn's order"
- 재현 (rotate, 후보 a·b·c):
  1. 새 유저 턴: state 없음 → `applyStrategy`가 turns 0→1, ordered=[a,b,c], a가 응답,
     저장 state = `{ turns: 1 }` (index.ts:875-876, recordServed는 rotate에서 state 불변).
  2. 요청 실패 → Pi가 `reason: "retry"`로 재요청, state `{ turns: 1 }`.
  3. index.ts:784가 **이미 전진된 turns=1**로 전략을 다시 계산 → ordered=[b,c,a].
     실패한 턴의 순서([a,b,c])가 아니라 한 칸 더 돌아간 순서다.
  4. failedLabel="a"는 이 순서의 끝(index 2) → `stepForward`의 rest=[] → undefined →
     "chain is exhausted after 3 candidates" throw. b·c가 모두 살아 있어도 턴이 죽는다.
  후보 2개 이상인 rotate 그룹에서 **첫 선택 실패가 항상 턴 실패**가 된다.
- 위반: 2.2(재적용으로 상태를 왜곡), 설계 §3("retry·continuation은 … 같은 회전을
  이어받는다" — 실패한 턴의 순서를 걸어야 한다), 2.9(index.test.ts에 rotate+retry 경로
  없음). index.ts:866의 주석이 주장하는 계약과 코드가 어긋난다.
- 최소 수정: retry 경로는 실패한 턴이 출발한 순서로 걸어야 한다. 예: fresh turn이 저장하는
  strategy state에 "다음 턴 오프셋"과 "현재 턴 오프셋"을 구분해 두거나, retry에서
  applyStrategy 재계산 시 turns를 하나 되돌린 상태로 계산한다. least-used(state.served)는
  재계산해도 순서가 불변이므로 rotate만 해당한다.
- 같은 결함을 가린 시험: P2-1 참조.

### P1-1 (보완 필요) `DecisionReason`을 import 없이 사용 — 타입 검사 계약 깨짐
- 위치: extensions/aaii-router/index.ts:793 · explain.ts:14
- 인용: index.ts:793 `reason: DecisionReason,` — index.ts의 explain.ts import는
  154행(`describeDecision, forgetDecision, lastDecision, recordDecision`)과 155행
  (`consideredList, coolingDescriptions`)뿐이고, 타입 import 목록(100-156행 전수 확인)에
  `DecisionReason`이 없다. explain.ts:14가 유일한 정의다.
- 위반: 2.10(정적 분석 통과 전제), 기본 컴파일 계약. 런타임은 타입 소거로 지나가고
  node --test도 통과하지만 tsc/IDE/타입 검사가 깨진다.
- 최소 수정: `import type { DecisionReason } from "./explain.ts";` 한 줄.

### P1-2 (보완 필요) groups 부분 거부 note가 대화형 경로(설정 창·`set`)에서 삼켜짐
- 위치: extensions/aaii-router/index.ts:441-447(설정 창 dialog), 644-651(`set`)
- 인용: 두 경로 모두 `const edited = editSetting(settings, descriptor.key, …)` 뒤
  `edited.ok`만 보고 `edited.notes`를 버린다. settings.ts의 `editSetting` "groups" 분기는
  `{ ok: true, settings, notes: rejected }`를 돌려주는데(explain.ts가 아니라 settings.ts의
  groups 케이스), 호출자가 읽는 곳이 없다. 이후 `serializeSettings`는 검증을 통과한
  그룹만 파일에 쓰므로, 다음 읽기에서는 거부된 항목 자체가 사라져 보고할 근거도 없어진다.
- 결과: 운영자가 `/aaii-router set groups [{"id":"qwen",…},{"id":"bad id",…}]`를 넣으면
  "bad id"가 **아무 말 없이** 버려지고 성공 알림만 온다. 2.7의 오류 삼키기·조용한
  기본값이며, 설계 §9("groups의 부분 생존 … 어느 경로로 들어와도 보고된다")의 취지와도
  불일치한다. 파일·환경 경로만 note가 보고된다(parseSettings가 edited.notes를 push).
- 최소 수정: 두 호출 지점에서 `edited.notes`를 `ctx.ui.notify`로 보고(설계 §9 문구대로).
- 위반: 2.7, 설계 §9.

### P2-1 (사소함) rotate retry 시험이 route()가 실제 저장하는 state가 아니라 입력 state를 재주입
- 위치: extensions/aaii-router/strategy.test.ts "rotate only moves on a fresh turn" 테스트
- 인용: `const duringTurn = applyStrategy(CHAIN, context);` 직후
  `applyStrategy(CHAIN, { ...context, state: context.state })` — 즉 전진 **전** state
  ({turns:1})을 retry 입력으로 넣는다. 실제 route()는 fresh turn에서 `distributed.state`
  ({turns:2})를 저장하고(index.ts:875-876), retry는 그것을 받는다. 주석의 전제
  ("routeFor stores the incoming state on a retry")는 저장 시점을 잘못 서술했다.
  이 때문에 P0-1을 시험이 잡지 못했다. 2.9(생산자·소비자를 잇지 않은 시험,
  구현 세부에 묶인 시험).
- 최소 수정: P0-1 수정과 함께 "fresh turn 저장 state → retry 재계산"의 실제 연결을
  index.test.ts에서 재현하는 시험으로 교체.

### P2-2 (사소함) explain.ts의 죽은 매개변수와 죽은 필드
- 위치: extensions/aaii-router/explain.ts:85-95, 22 · index.ts:796-810
- 인용: `consideredList(ordered, chosen, limit)`에서 `chosen`은 본문에서 한 번도 쓰이지
  않는다(`*` 표시는 describeDecision이 decision.chosen으로 함, explain.ts:78).
  `RoutingDecision.when`(explain.ts:22)은 index.ts:799에서만 기록되고 읽는 곳이 없다
  (`when` 사용처 전수 확인: explain.ts:22 선언, index.ts:799 기록뿐).
  또 explain.ts:49의 `lastDecision()` 주석 "for tests"는 부정확하다 — 명령 경로
  (index.ts `/aaii-router explain`)가 쓰는 접근자다.
- 위반: 2.5(사용처 없는 정보), 2.2(전달만 하는 매개변수).
- 최소 수정: `chosen` 매개변수 제거, `when` 필드 제거(또는 describeDecision에 표시),
  주석 교정.

### P2-3 (사소함) 등록 팩토리의 재검증 루프와 registrationNotes는 도달 불가(항상 빈 배열)
- 위치: extensions/aaii-router/index.ts:563-579, 216, 718
- 인용: 팩토리는 `parsed.settings.groups`를 다시 `parseGroup`으로 검증하고 `seen`으로 id
  중복을 거르지만, 이 목록은 `parseGroupsValue`(settings.ts)를 이미 통과한 값뿐이다 —
  파일·환경·DEFAULT_GROUPS 어느 경로도 예외가 없다. 따라서 `validated.group === undefined`
  분기와 `seen.has(...)` 분기는 도달할 수 없고 `registrationNotes`는 항상 `[]`다
  (718행 보고서에서 항상 빈 채로 펼쳐진다). 설계 §9와 WORKLOG §9.3이 스스로
  "2.7 과잉 방어 … 제거 후보"로 기록해 두었으나 그대로 남아 있다.
- 위반: 2.7(도달 불가능한 상태의 검사), 2.5(쓰이지 않는 상태 필드).
- 최소 수정: 루프와 registrationNotes를 지우고 등록은 `parsed.settings.groups`를 그대로
  쓴다(설계 §9가 이미 제거를 예고한 항목).

### P2-4 (사소함) least-used가 fresh turn만 셈 — retry·continuation의 실제 응답자 미집계
- 위치: extensions/aaii-router/index.ts:869(retry), 848/857(continuation) vs 875-876(fresh)
- 인용: retry·continuation은 `request.state?.strategy ?? distributed.state`를 그대로
  저장하고 `recordServed`를 호출하지 않는다. 설계 §3은 least-used가 "실제로 응답한 후보를
  센다"고 정의한다 — retry·continuation 요청도 세션의 요청인데 응답자가 집계되지 않아
  카운트가 실제 분포를 반영하지 못한다.
- 위반: 설계 §3, 2.4(파생값이 출처에서 계산되지 않음).
- 최소 수정: retry·continuation 반환 전에 `recordServed(실제 응답 후보, strategy, 저장할 state)` 적용.

### P2-5 (사소함) README(확장)·설계가 주장하는 explain 노트가 구현에 없음
- 위치: extensions/aaii-router/README.md "Explain" 절 · 설계 §6 · index.ts:778-783, strategy.ts
- 인용: README "the adjustments that were applied (image demotion, pin demotion, rotation)",
  설계 §6 "note: 이미지 강등, rotate 인덱스, pin 강등 등". 구현 notes는 이미지 강등
  (index.ts:781)과 manual 무-pin 강등(strategy.ts)뿐이고 rotate 인덱스는 어디에도 note되지
  않는다. 2.11(보고·문서가 더한 것과 실제를 일치시킴).
- 최소 수정: 문서에서 "rotation"을 빼거나, rotate 사용 시 오프셋을 note에 추가한다.

### P2-6 (사소함) routingChanged의 groups 비교가 JSON.stringify라 키 순서에 민감
- 위치: extensions/aaii-router/settings.ts `routingChanged`
- 인용: `if (field === "groups") return JSON.stringify(previous) !== JSON.stringify(next);`
  파일에서 키 순서가 다른(`match`를 `id`보다 앞에 쓴) 동일 내용 groups는 직렬화 문자열이
  달라 routingChanged=true가 되고, 내용이 같은 저장에도 chain epoch가 올라 continuation이
  한 턴 끊긴다. 2.4(내용 비교는 내용으로).
- 최소 수정: 정규화(id·match·strategy·affinity 기준 정렬된 직렬화) 후 비교.

### P2-7 (사소함) index.ts:126 `preferred` 미사용 import, containsImage 중복 호출
- 위치: extensions/aaii-router/index.ts:126, 776-780
- 인용: `preferred`는 import만 되고 index.ts 내 호출이 없다(전수 확인).
  `settings.preferVision && containsImage(request.messages)`가 776-778과 779에서 두 번
  계산된다. 2.3/2.2. 각 한 줄 정리.

### P2-8 (보고) 시험 격차 — 설계 §8이 요구한 일부 계약이 시험되지 않음
- groups 항목의 **per-group strategy/affinity**가 route() 결과에 반영되는 것(설계 §8:
  "affinity/strategy가 route() 결과에 반영되는 것") — index.test.ts는 전역 affinity=turn만
  검증하고 groups 항목의 override는 검증하지 않는다. explain의 cooling·notes 내용도
  미검증. WORKLOG §9.4의 mutation check가 "예비"로 남아 있다(2.9는 핵심 새 시험의
  mutation check를 요구; WORKLOG 자체가 "별도 레인에서 다시 돌아갑니다"라고 기록).

## 검사해서 문제 없었던 영역

- **설정 3출처 병합·검증·라운드트립**: 전역→프로젝트(PROJECT_KEYS 제한)→환경 순서, 부분
  적용(`applied`), 나쁜 env override가 파일 값을 지우지 않음 — settings.test.ts가 실제
  경계별로 확인. 파일 원자적 쓰기와 .tmp 잔여 없음 확인 포함.
- **구형 state 호환**: RouterState의 새 필드(strategy, strategyName)는 전부 optional이고,
  parseStrategy(undefined)→전역 strategy, `state?.strategy ?? distributed.state` 경로로
  구형 state({label, cooldowns, epoch})가 읽힌다. index.test.ts legacy 테스트가 확인.
- **routes.ts 삭제(2.3)**: `RouteDefinition`·`candidatesForRoute`·`ROUTES`·`routes.ts`
  참조가 extensions/ 전체에서 0건. 매처 계약은 groups.test.ts가 옛 routes.test.ts의
  케이스(접두·접미·변이 안, 다른 버전 밖, `:free` 접미)를 그대로 이어받음.
- **쿨다운 에스컬레이션 경계**: 창 안 재실패 연장+hits, 상한 4배, 만료 뒤 새 창 —
  cooldown.test.ts가 리터럴 시계로 확인. rememberFailure의 stretch 계산은 설계 §5와 일치.
- **쿨다운이 "모델 없음"이 되지 않는 안전 동작**: preferred/stepForward의 head 폴백 유지.
- **`/aaii-router next`의 route 선택**: branchSelection이 model_change 뒤 stale state를
  버리는 경로와 family route의 자기 후보만 보는 보고(publishStatus) — index.test.ts가
  model_change 유출 시나리오까지 확인.
- **신뢰 경계**: untrusted 프로젝트 파일 미읽기 + 존재만 검사 + note 보고, 존재 검사 실패
  시 이유 보고 후 기본값으로 계속 — 2.7의 "실패는 드러나되 라우팅을 막지 않음" 충족.
- **점수 파일·설정 파일 읽기 오류 전파**: ENOENT만 없음, 나머지는 경로·이유를 담아 전파
  (index.test.ts EISDIR 케이스) — 조용한 대체 없음.
- **전략의 단일 출처**: applyStrategy는 주어진 목록만 재정렬하고 점수·티어를 재유도하지
  않음 — strategy.test.ts가 exclusion 상위 적용까지 확인. 3절 덧대기(이름만 다른 같은
  형태) 해당 없음: takeHead 제거, excludedModels 미신설은 WORKLOG §9.2대로 확인됨.

## Merge verdict

**BLOCK** — P0-1(rotate+retry 체인 오소진)과 P1-2(대화형 경로의 groups note 삼킴)를
수정하고 P2-1의 시험을 실제 생산자→소비자 연결로 교체한 뒤 재검토. P1-1은 한 줄 수정이지만
타입 계약이므로 같은 변경에 포함될 것.
