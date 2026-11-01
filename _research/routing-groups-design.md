# 설계: Magpie routing의 채택 기능을 aaii-router에 접붙이기

작성일: 2026-10-31 · 정본 2.1 (설계 우선·책임 소재)에 따른 설계 기록
입력: `_research/routing-extension-survey.md` (채택 처분), `_research/magpie-tui-reference.md`,
사용자 요구 — "Magpie의 routing 기능을, 기존 카탈로그 모델을 **자동으로** 라우팅하는 형태로."

## 0. 추가 설계 (11-01): aggregator 공급자 기본 제외

사용자 결정 — "Magpie, openrouter 같은 공급자(다른 라우터·중개자)의 모델은 이 체인의 후보에서
제외한다." 판정:

- **책임 소재**: candidates.ts의 `DEFAULT_EXCLUDED_PROVIDERS`(신설 상수)가 단일 출처.
  `DEFAULT_SETTINGS.excludedProviders`가 그것을 재사용 — 설정 파일이 출처를 덮어쓴다
  (빈 배열을 쓰면 되돌릴 수 있다).
- **대상**: `magpie`(라우팅 게이트웨이), `openrouter`(중개자). 근거: 이 체인은 "공급자 직행"이
  전제(README "providers direct")이고, 라우터를 라우터의 후보로 넣는 건 우회다. 이번 실물
  검증에서 후보 42개 중 다수가 `magpie/*`였다는 실측이 요구의 계기.
- **의미 변경**: 기본 후보 집합이 줄어든다. 기존 사용자가 magpie/openrouter를 쓰고 있었다면
  라이브 설정의 `providers`에 명시적으로 되돌려야 한다 — 시험·README 갱신 대상.
- 라이브 설정(`~/.pi/agent/aaii-router.json`)은 이미 cline·dashscope·experientiallabs·
  openrouter·qwen-remote를 제외 중 — 거기에 magpie를 **사용자 설정으로** 추가하고, 기본값
  변경은 저장소의 기본값으로 한다.

## 1. 책임 배치 (바뀐 뒤 누가 무엇을 소유하는가)

| 책임 | 소유 | 변경 |
|---|---|---|
| 라우팅 그룹 정의(이름·매처)와 후보 가르기 | `groups.ts` (신설) | `routes.ts`를 흡수·삭제 (2.3) |
| 그룹별 요청 분배 전략(순서 만들기) | `strategy.ts` (신설) | 신설 — 전략은 새 책임 |
| 실패 기억(쿨다운)과 반복 실패 에스컬레이션 | `cooldown.ts` | 확장 — 창 연장 규칙 추가 |
| 어느 턴이 어느 후보에 머무는가(친화도) | `cooldown.ts` `chooseTurnCandidate` | 확장 — affinity 매개변수 |
| 설정 읽기·검증·쓰기 | `settings.ts` | 확장 — `strategy`·`affinity`·`groups` 키 |
| 결정 기록과 설명 | `explain.ts` (신설) + `index.ts`가 기록 | 신설 |
| 등록·명령·route() 조율 | `index.ts` | 수정 |

단일 출처 유지: 정렬 정책(점수→티어→id)은 그대로 `candidates.ts`가 소유하고, 전략은 그 위에서만
작동한다. `order` 전략이 현재 정책이며 기본값이라 coding-fallback과의 체인 일치는 변하지 않는다.

## 2. 그룹 (Magpie groups의 일반화, family route의 대체)

- 설정 파일의 `groups` 배열: `{ id, name?, match?, strategy?, affinity? }`.
- `match`는 canonical family key(`deepseek-v4-1-flash`) — 자동 수집된 후보를 가르는 **필터**일 뿐,
  멤버를 손으로 나열하지 않는다. 이것이 "기존 목록 자동 라우팅"과 Magpie 패턴 히트의 합성점.
- `id: "aaii"`는 예약(전체 체인, 항상 등록). 파일에서 그 id는 거부해 보고한다.
- 기본 `groups` = 지금의 하드코딩 family 2개(deepseek·glm). **파일이 단일 출처** — 기본값은
  seed이고 `serializeSettings`가 파일에 심으며, operator가 지우면 사라진다.
- 그룹의 등록 목록은 확장 로드 시 확정(`registerVirtualModel`은 로드 시 1회), 매처·전략은 요청마다
  settings에서 다시 읽는다. 그룹 추가·삭제는 Pi `/reload` 후 반영 — README에 명시.

## 3. 전략 (`strategy`, Magpie `o`의 부분 집합)

| 값 | 뜻 | 구현 |
|---|---|---|
| `order` (기본) | 정책 순서 (점수→티어→id, pin 선두) | 현재 동작 그대로 |
| `free-first` | 쿼티 티어 먼저, 티어 안 점수순 | 티어→점수→id 재정렬 |
| `rotate` | 턴마다 다음 후보 (일일 계정 순환) | state에 턴 카운터(`turns`), 새 유저 턴에서만 전진 — retry는 저장된 `turns`에서 1을 되돌린 상태로 순서를 재계산해 실패한 턴이 출발한 순서를 걷고, continuation은 요청 상태의 `strategy`를 보존한다 |
| `least-used` | 세션에서 요청 수가 가장 적은 후보 우선 | state에 라벨별 요청 수(`served`); 동률은 기존 체인 순서 유지(안정 정렬). 실제로 응답한 후보를 센다 — 냉각 스킵이나 `turn` 친화도가 순서의 머리를 옮겼을 수 있으므로 |
| `manual` | pin에 고정 — pin만 순회 | `applyChainSettings`가 pin을 선두에 세운 뒤의 목록에서 pin만 남긴다. pin 없으면 `order`로 강등(note) |

기각: pace/weighted/smart — 근거(실제 수요) 없음. 적용 순서: 이미지 강등(orderForRequest) 먼저,
전략 나중 — 이미지는 능력 제약이고 전략은 분배 선호다.

## 4. 친화도 (`affinity`, Magpie `s`의 부분 집합)

| 값 | 뜻 |
|---|---|
| `auto` (기본) | 현재 동작: continuation/retry 유지, 새 턴은 기억한 후보(유효하면) |
| `session` | 기억한 후보가 유효하면 체인 구성 변경(epoch)을 넘어서도 유지 — 실패가 옮겨놓은 후보가 새 기억이 되므로, 실패 뒤에 새 턴이 되돌아오지 않는 효과는 같다 |
| `turn` | 새 턴은 항상 선두에서 시작 (휴지 절약) |

기각: off(turn과 구현이 같아 이름만 다른 것 — 3절), strict(Pi가 오류를 그대로 돌려보내는 모양),
영속 sticky(pi-router) — state가 세션 브랜치 단위인 한 파일 영속은 신선도 문제가 따라온다.

## 5. 반복 실패 에스컬레이션 (생태계 서킷 브레이커의 필요 부분)

같은 후보가 **창이 끝나기 전에** 다시 실패하면 창을 `window`만큼 연장하고 횟수를 센다.
상한: 창 4배 (기본 20m) — 무한 연장은 한 모델을 사실상 영구 제외하므로.
closed→open→half-open 상태 기계 전체는 하지 않는다: 우리는 route() 시점에 실패를 알고 다음
후보로 넘어가므로, half-open의 역할(재시험)을 쿨다운 만료가 이미 한다.

## 6. 결정 설명 (`/aaii-router explain`, pi-router·pi-auto-router 채택)

route()가 마지막 결정을 메모리에 1개 기록: 이유(reason), 전략·친화도, 고려한 상위 후보, 냉각
목록, 선택된 후보, 적용된 조정(note: 이미지 강등, rotate 인덱스, pin 강등 등). 명령이 그려서
보여준다. 최근 1개만 — 세션별 이력은 YAGNI (pi-auto-router의 JSONL은 필요해진 뒤에).

## 7. 지우는 것 (2.3)

- `routes.ts`, `routes.test.ts` — `PROVIDER`·`matchesFamily`·`candidatesForRoute`·`ROUTES`는
  `groups.ts`로 옮겨지고 나머지는 groups 설정으로 대체. 하드코딩 family 2개는 소멸.
  (구현 완료: 2026-10-31, `candidatesForRoute` → `candidatesForGroup`, `RouteDefinition` →
  `GroupDefinition`.)
- `chooseTurnCandidate`의 시그니처 확장 — 기존 호출 지점(index.ts, 테스트) 모두 함께 고침.
- (구현에서 추가로 지운 것) 전략 모듈의 `takeHead`(순서 머리 재적용 우회)는 fresh-turn 경로가
  `chooseTurnCandidate`의 결과를 직접 쓰면서 불필요해져 `recordServed`(least-used 카운트만)로 대체·삭제.
  `applyStrategy`의 `excludedModels` 매개변수는 `applyChainSettings`가 이미 처리한 것의 재적용이라
  신설되지 않았고(`manual`용 `pinnedModels`만 남음), strategy.ts는 그 상태로 확정.

## 8. 시험 계약 (2.9)

- `groups.test.ts`: 매처는 기존 routes.test.ts의 계약을 이어받는다(접두·접미·변이 안, 다른 버전 밖),
  id 예약·중복 거부, 그룹별 후보 단축, 기본 그룹.
- `strategy.test.ts`: 각 전략이 같은 입력에서 기대 순서를 내는 것, rotate/least-used의 상태 진행,
  manual의 pin 없음 강등, 이미지 강등이 전략보다 먼저인 것.
- `cooldown.test.ts` 확장: 창 안 재실패 → 연장과 hits, 상한 4배, 창 만료 뒤 실패는 연장이 아니라 새 창.
- `settings.test.ts` 확장: strategy/affinity의 단어 검증, groups 배열 파싱(잘못된 항목은 note,
  good 항목은 생존), groups가 PROJECT_KEYS 밖(프로젝트 거부) 확인, 라운드트립.
- `index.test.ts` 확장: 그룹별 가상 모델 등록, explain 기록, affinity/strategy가 route() 결과에
  반영되는 것. mutation check로 규칙을 틀게 바꿨을 때 실패 확인.

## 9. 구현 상태 (2026-10-31, 작업자 기록)

설계 대로 구현됐고, 아래가 설계 문구 대비 확정·보완한 지점이다.

- `groups` 설정 키는 전역 전용(`PROJECT_KEYS` 밖) — 프로젝트 파일이 쓰면 note와 함께 거부. 팩토리의
  등록 목록 확정도 전역 파일 + 환경만 읽는다.
- `serializeSettings`는 그룹의 `strategy`/`affinity`를 값이 있을 때만 기록해 라운드트립을 지킨다.
- `editSetting`의 성공 결과에 `notes`를 허용해 groups의 부분 생존(잘못된 항목 note + 좋은 항목 적용)이
  파일·환경 어느 경로로 들어와도 보고된다.
- `routingChanged`는 groups를 정규화한 내용으로 비교한다 — 그룹을 [id, match, name, strategy, affinity]
  튜플로 바꿔 id 기준 정렬한 뒤 비교하므로, 키 순서만 다른 동일 내용 저장은 epoch를 올리지 않는다.
  파싱해 새로 만든 레코드는 identity로는 같을 수 없어, identity 비교는 모든 설정 쓰기가 체인 epoch를
  올리는 버그가 된다(실제로 테스트가 잡았다).
- 등록 시의 `parseGroup` 재검증과 id 중복 제거는 도달 불가능한 과잉 방어(2.7)로 확인돼 제거했다:
  `groups` 값은 항상 `parseGroupsValue`를 통과하므로 `parsed.settings.groups`를 그대로 등록한다.
