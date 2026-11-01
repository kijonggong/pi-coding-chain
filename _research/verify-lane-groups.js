// 검증 레인: 독립 리뷰(읽기 전용) + mutation check(사본) — 병렬.
// 두 아이 모두 원본 트리를 수정하지 않는다(보고서 파일 제외).
const review = await runs.run("review", {
  label: "Review group routing implementation",
  agent: "reviewer",
  cwd: "D:/repository/pi-coding-chain",
  task: `역할: 구현에 참여하지 않은 독립 코드 리뷰어 (읽기 전용 — 어떤 소스 파일도 수정/생성/삭제 금지, git 조작 금지. 보고서 파일 하나만 작성).

대상 저장소: D:/repository/pi-coding-chain (커밋되지 않은 변경이 작업 트리에 있음 — 이것이 검토 대상).

먼저 읽을 것:
1. docs/engineering-standard.md — 판정 기준 전부. 지적에는 절 번호(2.1–2.9, 3절)를 붙인다.
2. _research/routing-groups-design.md — 이번 변경의 설계(구현이 따라야 할 명세).
3. _research/routing-extension-survey.md — 채택/기각 근거.

검토 범위 (변경 집합 전체):
- 신설: extensions/aaii-router/groups.ts, strategy.ts, explain.ts + 각 test
- 수정: extensions/aaii-router/cooldown.ts, settings.ts, index.ts + 각 test, README(확장/루트), WORKLOG.md
- 삭제: extensions/aaii-router/routes.ts, routes.test.ts
- 참고(수정 없음): candidates.ts, chain-order.ts, fallback-editor.ts, fallback-tui.ts, coding-fallback의 providers.ts/scores.ts

확인할 것:
1. 실제 사용 경로: route()의 세 갈래(continuation/retry/fresh)와 /aaii-router 명령 경로가 실제로 닿는 코드만 평가. 도달 불가능한 분기·죽은 매개변수·쓰이지 않는 상태 필드를 찾아라.
2. 입출력 계약: 설정 파일(전역/프로젝트/환경 3출처) 병합·검증·라운드트립, route() 반환 state의 형태가 세션 재개에서 그대로 읽히는지(구형 state 필드 부재 시에도).
3. 실패 전파: 조용한 기본값(2.7), 오류 삼키기, 실패를 가리는 대체 경로. 특히 설정 파싱 실패·등록 실패가 어디서 어떻게 드러나는지.
4. 중복과 단일 출처(2.3, 2.4): 같은 일을 하는 길이 두 개인 곳, 파생값 복사, 대체됐는데 남은 것.
5. 시험(2.9): 구현 세부에 묶인 시험, 같은 사실의 반복 단정, 실제 계약을 확인하지 않는 시험, 기준 완화로 통과시킨 시험. 각 새 시험이 어떤 고장을 어느 경계에 주입해 잡는지 설명할 수 없는 시험을 지적하라.
6. 3절 덧대기 판정: 이름만 다른 같은 형태가 없는지.
7. 설계(_research/routing-groups-design.md)와 구현의 불일치.

각 지적: 파일:줄, 인용, 위반한 절, 심각도(차단/보완 필요/사소함). 의심만 쓰지 말 것 — 인용으로 뒷받침할 것. 지적이 없는 영역도 검사한 범위로 명시할 것.

보고서를 _research/review-groups-independent.md에 쓰고, 최종 메시지에 지적 요약(건수와 상위 3개)을 적어라.`,
});

const mutation = await runs.run("mutation", {
  label: "Mutation check on a copy",
  agent: "worker",
  cwd: "D:/repository/pi-coding-chain",
  task: `역할: mutation check 작업자. 원본 작업 트리는 절대 수정 금지 — 모든 변이는 사본에서만.

원본: D:/repository/pi-coding-chain. 사본: 임시 디렉터리(예: %TEMP% 아래)에 전체 복사(cp -r 또는 robocopy, .git 제외 가능, node_modules 불필요 — 테스트는 node 내장 러너로 의존성 없음).

0단계(동일성 확인): 사본에서 \`PI_OFFLINE=1 PI_CODING_FALLBACK_FREE_REFRESH=off node --test extensions/*/*.test.ts\` → 원본과 동일하게 280 pass 0 fail임을 확인하고 기록. 다르면 중단하고 보고.

1단계(변이 실행): 사본에서 아래 규칙들을 하나씩 틀리게 바꾸고, 매번 관련 시험 파일(또는 전체)을 돌려 실패하는지 기록한 뒤 원복:
- strategy.ts rotate 오프셋을 +1 시키거나 회전 자체를 제거
- strategy.ts least-used 정렬을 반대로(내림차순)
- strategy.ts manual의 pin 없음 강등 note 제거
- strategy.ts free-first 정렬에서 티어 비교 제거(점수만)
- cooldown.ts rememberFailure의 연장 상한(COOLDOWN_MAX_STRETCH) 제거
- cooldown.ts 만료 창의 hits 재사용(만료 뒤 실패도 연장으로 처리)
- cooldown.ts chooseTurnCandidate의 affinity==='turn' 분기 제거(항상 auto 동작)
- groups.ts parseGroup의 aaii 예약 거부 제거
- settings.ts routingChanged의 groups 비교를 내용 비교에서 참조 비교로 되돌림
- index.ts explain 기록 제거(record 호출 주석화)
- groups.ts candidatesForGroup의 tieOrder 정렬 제거(필터만)

2단계(생존 변이 탐색): 위 목록 외에 사본에서 스스로 규칙 2개 이상을 골라 같은 절차를 반복(예: 에스컬레이션 hits 카운트를 안 올림, group 이름 기본값 제거, coolingDescriptions 정렬 제거 등).

3단계(보고): 각 변이마다 { 변이 내용, 돌린 시험, 결과(kill/survive), survive면 그 규칙을 지키는 시험이 없다는 뜻 — 어느 계약이 무방비인지 }. survive가 있으면 원본 코드 파일·줄과 함께 명시. 사본은 삭제하고 원본 트리가 변하지 않았음을 git status --short로 확인해 기록.

보고서를 _research/mutation-groups.md에 쓰고, 최종 메시지에 kill/survive 요약을 적어라.`,
});

const [reviewResult, mutationResult] = await runs.all([review, mutation]);
return { review: reviewResult.output, mutation: mutationResult.output };
