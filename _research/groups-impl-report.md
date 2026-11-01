# 구현 보고: Magpie routing 채택 기능을 aaii-router에 접붙이기

작성일: 2026-10-31 · 정본 `docs/engineering-standard.md` 4절 점검표 형식
· 설계: `_research/routing-groups-design.md` (§9에 구현 상태 갱신)
· 처분 근거: `_research/routing-extension-survey.md`

## 4절 점검표

### 바꾼 책임의 소유 모듈과 바뀐 뒤의 구조

routes.ts(하드코딩 family route 2개 + full chain)는 groups.ts(설정 파일이 출처인
라우팅 그룹: `GroupDefinition`·`matchesFamily`·`candidatesForGroup`·`parseGroup`·
`DEFAULT_GROUPS`)로 대체됐고, 분배 전략은 `strategy.ts`, 실패 기억·친화도 선택·창
연장은 `cooldown.ts`, 결정 기록·설명은 `explain.ts`(기록은 `index.ts`가 한다),
설정 읽기·검증은 `settings.ts`, 등록·명령·route() 조율은 `index.ts`가 소유합니다.

### 더한 것 / 뺀 것

**더한 것**
- `groups.ts`, `strategy.ts`, `explain.ts` (신설, 각각 시험 파일 포함)
- settings 키 `strategy`·`affinity`·`groups` — descriptor 3개, `editSetting` case 3개,
  `parseGroupsValue`, 환경변수 `PI_AAII_ROUTER_STRATEGY/_AFFINITY/_GROUPS`,
  `SUGGESTED_VALUES`, `SUBCOMMANDS.explain`
- `/aaii-router explain` 서브커맨드, session_start의 `forgetDecision()`
- 쿨다운 반복 실패 에스컬레이션: 창 안 재실패 → 창 재개장 + `hits` 증가, 상한
  `COOLDOWN_MAX_STRETCH = 4`배, 만료 뒤 실패는 새 창, `describeCooldown` 반복 표기
- `chooseTurnCandidate`의 affinity 매개변수(auto/session/turn),
  `RouterState.strategy`·`strategyName`
- `index.ts`의 비동기 팩토리: 전역 파일+환경만 읽어 `registeredGroups =
  [FULL_CHAIN, ...groups]` 확정(id 중복 제거, `parseGroup` 재검증, 충돌 note) 후
  `registerVirtualModel` 등록 — groups는 전역 전용이라 프로젝트 파일은 읽지 않음

**뺀 것 (지운 옛 경로·함께 고친 호출 지점)**
- `routes.ts`·`routes.test.ts` 삭제 (2.3). `ROUTES`·`RouteDefinition`·
  `candidatesForRoute` 소멸 — `grep -rn "routes.ts|RouteDefinition|candidatesForRoute|ROUTES"
  extensions/aaii-router/*.ts` 소스 0건.
- `strategy.ts`의 `takeHead`: fresh-turn 경로가 `chooseTurnCandidate`의 결과를 직접
  쓰면서 순서 머리 재적용 우회가 불필요해짐(2.2) → `recordServed`(least-used served
  카운트만)로 대체·삭제. 호출부·테스트 함께.
- `applyStrategy`의 `excludedModels` 매개변수: `applyChainSettings`가 이미 처리하는
  것의 재적용(2.2 중간 계층)이라 신설하지 않고 `manual`용 `pinnedModels`만 남김.
  strategy.ts 문서 주석도 그 경계를 서술.
- `index.ts`의 `next` 서브커맨드: `ROUTES.find` → `registeredGroups.find` +
  `candidatesForGroup`.
- `settings.ts`의 중복 `SETTING_KEYS` 선언(구문 오류) 제거.

### 3절 형태를 쓴 곳과 정당한 이유

없음. 대체된 routes 경로는 같은 변경에서 지웠고, 같은 일을 하는 길은
`groups.ts` → `index.ts` 하나뿐입니다. 다음 담당이 원래 설계로 오인할 여지를 남기지
않도록 설계 문서에 구현 상태(§9)를 기록했습니다. 다만 하나 남겨둔 경계 검사가
있습니다: 팩토리의 `parseGroup` 재검증·id 중복 제거는 작업 지시 명시 항목이지만,
`groups` 값은 이미 `parseGroupsValue`(파일·환경 어느 경로든)를 통과하므로 실제로는
도달하지 않습니다 — 2.7 과잉 방어에 해당하며 제거 후보로 설계 문서 §9에 적었습니다.

### 새 구조·정보의 실제 역할과 소비자, 기존 기능 활용/교체 근거

- 그룹(`groups.ts`): `/model`의 가상 모델 선택자와 routeFor의 후보 필터가 소비.
  기존 `routes.ts`의 canonical key 기계를 그대로 승계해 family 일반화로 교체 —
  Magpie 패턴 히트가 아니라 자동 수집 후보의 필터라는 설계 §2 합성점 유지.
- 전략(`strategy.ts`): `candidatesForGroup`이 준 순서만 재정렬 — 점수→티어→id 정책의
  단일 출처(`candidates.ts`)를 침범하지 않음. `order`가 기본이라 coding-fallback 체인
  일치 불변.
- 친화도(`cooldown.ts`): `chooseTurnCandidate` 확장. auto가 기존 동작과 동일해 기본
  관찰 동작 보존.
- explain(`explain.ts`): route()가 기록하고 `/aaii-router explain`이 그림 — pi-router·
  pi-auto-router 채택(조사 문서 격차 4).
- 에스컬레이션(`cooldown.ts` `rememberFailure`): pi-router 서킷 브레이커의 필요 부분만
  (조사 문서 격차 5). half-open 상태 기계는 쿨다운 만료가 이미 대역이라 만들지 않음
  (2.9 대역 중복 회피).

### 시험마다 지키는 계약 한 줄과 mutation check

| 시험 | 지키는 계약 |
|---|---|
| `groups.test.ts` — 등록 목록 | 하나의 `fallback` 프로바이더가 full chain + 시드 family 그룹 2개를 등록한다 |
| `groups.test.ts` — 매처 | family는 canonical key 위의 dash-delimited 토큰이다(접두·접미·변이 안, 다른 버전·비-flash 밖, `:free` 접미는 동일 모델) |
| `groups.test.ts` — 후보 단축 | family 그룹은 매칭 후보만 tier순(재보충 빠른 순→label)으로 걷고 full chain은 준 순서를 유지한다 |
| `groups.test.ts` — parseGroup | id 예약·비-canonical match·잘못된 strategy/affinity는 거부되고 name은 기본값을 가진다 |
| `strategy.test.ts` — order | 전략 없음 = 체인 순서 그대로, 상태 무손상 |
| `strategy.test.ts` — free-first | 티어 오름차순이 먼저고 티어 안은 점수→label이다 |
| `strategy.test.ts` — rotate | 새 유저 턴마다 다음 후보에서 시작하고 감아돈다; retry가 상태를 보존하면 같은 회전이 유지된다 |
| `strategy.test.ts` — least-used | 요청 수가 가장 적은 후보가 먼저고 동률은 체인 순서를 유지한다; 실제 응답한 후보를 센다(`recordServed`) |
| `strategy.test.ts` — manual | pin만 순회하고 pin이 없으면 체인 순서로 강등하며 note를 남긴다 |
| `strategy.test.ts` — exclusion 경계 | 전략은 주어진 목록만 재정렬한다 — 상류에서 제외된 후보는 어떤 전략도 부활시키지 않는다 |
| `cooldown.test.ts` — 재실패 | 창 안 재실패는 창을 지금부터 다시 열고 hits를 센다 |
| `cooldown.test.ts` — 상한 | 연장은 4배에서 멈춘다(무한 연장 = 사실상 영구 제외 방지); hits는 계속 센다 |
| `cooldown.test.ts` — 만료 뒤 | 창이 닫힌 뒤의 실패는 연장이 아니라 새 창이다 |
| `cooldown.test.ts` — 표기 | 반복 실패는 `cooling …, rate-limit, N failures`로 보고된다 |
| `cooldown.test.ts` — affinity | auto=epoch가 유효할 때만 기억 후보 재개, session=epoch를 넘어서도 유지, turn=매 새 턴 선두 |
| `settings.test.ts` — strategy/affinity | 단어 검증이 edit·file·env 세 경계에서 동일하고 env가 이긴다(잘못된 override는 설정값을 지우지 않는다) |
| `settings.test.ts` — groups 파싱 | 잘못된 항목은 note되고 좋은 항목은 생존한다; 중복 id·예약 aaii·비배열은 거부된다 |
| `settings.test.ts` — groups 신뢰 경계 | groups는 redirect 설정이라 프로젝트 파일이 못 쓰고 환경은 쓸 수 있다 |
| `settings.test.ts` — 라운드트립 | serialize→parse가 group의 strategy/affinity까지 보존한다 |
| `index.test.ts` — 등록 | 팩토리가 full chain + 시드 그룹을 순서대로 등록한다 |
| `index.test.ts` — explain | 마지막 결정을 그리고 없으면 "no routing decision yet"를 말한다 |
| `index.test.ts` — affinity=turn | 새 턴마다 기억 상태와 무관하게 순서 머리로 돌아간다 |
| `index.test.ts` — 기존 계약 | `[aaii-router/glm-5.3-flash] no eligible model` 문구, 상태줄 `aaii → label` 형식, 냉각·고정·재시도 동작 유지 |

**mutation check(예비, 별도 레인에서 재실행 예정)** — 규칙을 틀리게 바꿔 실패 확인 후 원복:

| 변이 | 결과 |
|---|---|
| ① rotate 오프셋 +1 (한 턴 먼저 전진) | 3개 실패 (strategy 2 + index 1) |
| ② least-used 내림차순 정렬 | 1개 실패 |
| ③ manual 강등 note 제거 | 1개 실패 |
| ④ 창 연장 상한 제거 | 1개 실패 |
| ⑤ 만료 창의 hits 재사용 (연장으로 오판) | 1개 실패 |
| ⑥ affinity=turn 분기 무시 | 2개 실패 (cooldown + index) |
| ⑦ aaii 예약 거부 제거 | 2개 실패 (groups + settings) |
| ⑧ routingChanged groups identity 비교 | 2개 실패 (index) — 구현 중 실제로 발견한 버그 |

⑧은 구현 과정에서 실제로 있었던 결함입니다: 파싱해 새로 만든 그룹 레코드는 identity로는
같을 수 없어 **모든 설정 쓰기가 체인 epoch를 올려** stickiness가 깨졌습니다. groups를
내용(JSON)으로 비교하도록 고쳤고, 이를 잡던 기존 reset 테스트 2개가 그대로 방어합니다.

### 남긴 임시 코드와 제거 조건

- 팩토리의 `parseGroup` 재검증·id 중복 제거(`index.ts`): 작업 지시 명시 항목. `groups`
  값이 항상 `parseGroupsValue`를 통과하므로 도달하지 않음 — **제거 조건**: 작업 지시의
  이중 검증 요구가 철회되거나(2.7) groups 값의 다른 진입 경로가 생길 때까지 유지.
  설계 문서 §9에 기록.
- 그 외 임시 코드 없음.

### 동작 보존 / 의미 변경 구분

- **의미 변경**: family route 2개가 하드코딩 → 설정 파일 출처(기본 시드가 같아 기본
  관찰 동작은 동일하지만, 파일이 출처라 operator가 지우면 사라짐); 전략 4종
  (free-first/rotate/least-used/manual)과 친화도 2종(session/turn), explain, 창 연장은
  새 동작. `hits` 필드 추가로 쿨다운 상태의 형태가 늘었으나 구형 상태(필드 없음)도
  읽힙니다.
- **동작 보존**: `order`(기본 전략)는 기존 정책 순서 그대로 — coding-fallback과의 체인
  일치 불변. continuation/retry stickiness, 쿨다운 1창, 이미지 강등, 상태줄, settings
  3출처 병합, 프로젝트 신뢰 경계 모두 유지. `remember(1)`류 기존 index 테스트가 무수정으로
  통과하는 것이 그 증거입니다(단, "keeps a failure" 쿨다운 테스트 1곳은 hits 필드 추가에
  맞춘 계약 갱신).

### 기준 완화가 아닌 계약 갱신 (보고 의무)

- `settings.test.ts` "writes a file it can read back": 직렬화 키 목록 단정에
  `strategy`·`affinity`·`groups`를 추가 — 파일이 3키를 더 쓰게 된 새 계약의 갱신이지
  단정 완화가 아닙니다.
- `cooldown.test.ts` "keeps a failure for the window": deepEqual에 `hits: 1` 추가 —
  에스컬레이션 설계의 새 필드입니다.

### 열린 질문 (설계가 애매했던 결정과 선택)

1. **groups 부분 생존의 빈 목록**: 파일의 groups 배열이 전부 무효면 빈 목록이 적용됩니다
   (note와 함께). "좋은 항목 생존" 규칙의 귀결이지만, operator가 실수로 전부 지운 경우
   family 그룹이 사라집니다. 빈 배열 자체는 합법적 값(그룹 없음)이라 기본값으로 되돌리지
   않았습니다.
2. **전략과 retry의 상호작용**: retry·continuation에서도 `applyStrategy`를 돌리되 요청
   상태의 `strategy`를 보존·저장합니다 — "회전은 새 유저 턴에서만 전진" 지시의 가장 좁은
   구현. retry 중 전략 설정이 바뀌면 `strategyName`이 이기 요청 시작 시의 전략을 유지합니다.
3. **least-used의 카운트 대상**: 순서 머리가 아니라 실제 응답한 후보를 셉니다 — 냉각
   스킵이나 turn 친화도가 머리를 옮길 수 있기 때문입니다. 설계 표에는 명시돼 있지 않아
   설계 문서 §3에 보완했습니다.
4. **session 친화도의 정의**: 설계 문구("실패로 옮겨진 뒤에도 새 턴에 돌아오지 않음")는
   구현상 epoch 독립성으로 귀결됩니다 — 실패가 옮겨놓은 후보가 새 기억이 되기 때문입니다.
   설계 문서 §4를 실제 기준으로 갱신했습니다.

## 전체 테스트 명령과 결과

```
PI_OFFLINE=1 PI_CODING_FALLBACK_FREE_REFRESH=off node --test extensions/*/*.test.ts
→ ℹ tests 280 · ℹ pass 280 · ℹ fail 0 (Windows git-bash, node v26.12.1)
```

`grep -rn "routes.ts|RouteDefinition|candidatesForRoute|ROUTES" extensions/aaii-router/*.ts`
→ 0건.

## 문서 갱신

- `extensions/aaii-router/README.md`: Routes → Groups 재작성(설정법·`/reload` 필요
  시점·에러 문구), Strategy/Affinity/Explain/Repeated failures 절 신설, 설정 표·환경변수
  표에 3키, Commands에 explain, Verification을 groups/strategy/index 테스트 서술로 갱신.
- 루트 `README.md`: aaii-router 행과 명령 블록에 explain·그룹 반영.
- `WORKLOG.md`: §9 신설 (4절 점검표 포함).
- `_research/routing-groups-design.md`: §3(rotate/least-used/manual 구현 확정)·§4
  (session 정의)·§7(지운 것에 takeHead 추가)·§9(구현 상태) 갱신.
