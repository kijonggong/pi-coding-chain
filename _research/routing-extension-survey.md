# 라우팅 확장 생태계 조사 — Magpie routing의 Pi 이식을 위한 기능 채택 후보

작성일: 2026-10-31
목적: "Magpie의 routing 기능을 Pi 전용으로, 기존 카탈로그 모델을 자동으로 라우팅"하는
앱을 만들기 앞서, 같은 책임을 이미 맡는 Pi 확장들을 조사해 채택/기각할 기능을 가른다.
근거 문서: `_research/magpie-tui-reference.md` (Magpie routing 분석),
`extensions/aaii-router/README.md` (현재 구현과 이전 결정들).

## 조사 대상

| 확장 | 버전/시점 | 한 줄 요약 |
|---|---|---|
| `pi-router` (jiangge) | 0.5.9, 2026-10-18, 8.4k/mo — 다운로드 최다 | `router/auto` + `router/<model>`: 채널(같은 모델×프로바이더) 폴백, 서킷 브레이커, 영속 sticky, latency/cost/manual 정렬, 위저드 |
| `pi-auto-router` (danialr) | 0.3.1, 2026-10-25 — 최신 | JSON 라우트 프로필 + same-request failover, 예산/UVI(할당 소진 속도), @단축키·키워드 의도 분류, explain·이벤트 로그·shadow 모드 |
| `pi-fallback-provider` | — | 우선순위 체인 + 재시도 가능 오류(429/529/timeout/network) 시 다음 모델. 가장 단순 |
| `pi-auto-fallback` | pi ≥ 0.81 | Pi 레지스트리의 모든 모델이 체인 참여(models.json·프로바이더 확장 포함). 일시 오류(524/timeout/429/5xx)에서 폴백 |
| `pi-provider-fallback` | 1.0.4, 2026-06 | 교차 프로바이더 폴백 + TUI 설정 |
| `pi-star-router` (ketchh) | 1.2.3, 2026-08 | 턴 전 프롬프트 프로파일링으로 결정적 라우팅. 프로젝트 파일 신뢰 경계 — aaii-router가 이미 채택 |
| `pi-router` (ygncode) | — | LLM 분류기(deepseek-v4-flash)가 요청+최근 맥락을 읽고 모델 선택. 키워드 라우팅 없음 |

## 기능 매트릭스

| 기능 | aaii-router (현재) | pi-router | pi-auto-router | Magpie |
|---|---|---|---|---|
| 가상 모델 등록 | ✅ `fallback/*` 3개 | ✅ `router/auto`, `router/<id>` | ✅ `auto-router/<profile>` 5개 | ✅ `group/<id>` (게이트웨이라 에이전트 공통) |
| 후보 자동 수집 (레지스트리) | ✅ 핵심 | ✅ autoSync | ❌ 설정에 명시 | ⚠ 패턴 히트(`*.free`)로 자동 흡수 |
| 폴백 단계 | 요청당 route() + retry에서 다음 후보 | 체인 순회 | same-request (출력 전) | 멤버 순회 |
| cooldown | ✅ 세션 브랜치 state, 창 1개 | ✅ + 서킷 브레이커 | ✅ in-memory + 서킷 브레이커 | ✅ (patience) |
| sticky | ✅ Pi 네이티브 (continuation/retry) | ✅ **재시작 넘어 영속** | ❌ | ✅ 5단계 (auto/session/turn/off/strict) |
| 정렬 전략 | 고정 (점수→티어→id) | latency/capability/cost/manual | adaptive/config + UVI 버킷 | 8가지 (in order, rotate, least used, pace, weighted, free first, manual, smart) |
| 사용자 정의 그룹 | ❌ family 2개 하드코딩 | ✅ models+channels | ✅ JSON routes | ✅ 그룹+패턴+중첩(최대 5) |
| 조건 규칙/분류 | ❌ (이전에 거절) | ❌ | ✅ @단축키·키워드 의도(무지연)·정책 엔진 | ✅ 규칙(use/tokens/time/days/folders)+분류기 |
| 결정 설명(observability) | ❌ 목록만 | ✅ explain·decisions | ✅ explain·이벤트 JSONL·분석 스크립트 | ❌ (TUI가 즉시 보여줌) |
| 지연 시간 추적 | ❌ | ✅ 정렬 기준 | ✅ 버킷 내 타이브레이커(rolling 100) | ❌ |
| 예산/잔액 | ❌ (티어표가 정책) | pricing 표시 | ✅ 일/월 예산·UVI·잔액 조회 | ✅ 잔액 확인 |
| shadow 모드 | ❌ | ❌ | ✅ | ❌ |
| 컨텍스트 전송(요약) | 불필요 — Pi 가상 모델이 네이티브 처리 | ✅ summary 모드 | ❌ | 불필요 — 게이트웨이 투명 |

## Magpie routing 대비 aaii-router의 격차

1. **그룹 모델**: Magpie는 사용자가 그룹(이름·멤버·패턴·전략·친화도)을 만들고 `group/<id>`로 고른다.
   aaii-router는 full chain + 하드코딩 family 2개뿐이다. "Magpie routing을 동일하게"의 핵심 격차.
2. **전략**: 점수순 하나. Magpie는 8가지를 `o` 키로 순환.
3. **친화도**: Pi 네이티브 sticky(continuation 유지)만. Magpie는 세션 전체 고정 등 5단계.
4. **관측성**: 마지막 요청이 왜 그 모델로 갔는지 설명하는 수단이 없다.
5. **반복 실패 처리**: 창 1개짜리 cooldown. Magpie patience와 생태계 서킷 브레이커는 실패 누적에 반응한다.

## 채택/기각 처분

### 채택 (설계 대상)

| 기능 | 출처 | 이유 |
|---|---|---|
| 사용자 정의 라우팅 그룹 | Magpie group + pi-auto-router의 JSON routes | 격차 1. 단, 멤버를 손으로 나열하는 대신 **패턴/패밀리 매처로 자동 수집 후보를 가르는** 형태로 합성한다 — "기존 목록 자동 라우팅" 요구와 Magpie의 패턴 히트가 만나는 지점. family 일반화는 기존 `routes.ts`의 canonical key 기계를 재사용 |
| 라우팅 전략 | Magpie (`o` 키 순환) | 격차 2. in order(현 정책), rotate, least used, free first, manual부터. weighted/pace는 근거(실제 수요)가 생길 때 |
| 세션 친화도 | Magpie (`s` 키) | 격차 3. auto(현동작)/session/turn/off 4단계. strict는 Pi가 에러를 그대로 돌려보내는 형태라 별도 근거 필요 |
| 결정 설명 `/explain` | pi-auto-router, pi-router | 격차 4. 마지막 route() 결정(후보·순위·냉각·이미지 조정·실패 분류)을 기록해 보여준다. Magpie는 TUI가 즉시 보여주는 것과 같은 역할 |
| 반복 실패 에스컬레이션 | pi-router·pi-auto-router 서킷 브레이커, Magpie patience | 격차 5. 같은 후보가 창 안에서 재실패하면 창을 연장한다. closed→open→half-open 상태 기계 전체는 과할 수 있으니 설계에서 판정 |
| 지연 시간 타이브레이커 | pi-auto-router(rolling avg), pi-router(sortBy latency) | 동점(같은 점수·같은 티어)일 때만 작동하는 2차 타이브레이커. 기존 정책을 대체하지 않는다 |

### 보류 (근거가 생기면 다시)

| 기능 | 출처 | 보류 이유 |
|---|---|---|
| sticky 영속화 (재시작 넘어) | pi-router | Pi의 router state는 세션 브랜치 단위라 재시작 시 사라진다. 파일 영속은 신선도 문제(오래된 기록)가 따라온다 |
| shadow 모드 | pi-auto-router | 새 정책 검증용. 그룹/전략이 자리 잡은 뒤에 가치가 있다 |
| 패턴 히트 (`*.free`) | Magpie | family 매처로 1단계 대체. 와일드카드 문법은 실제 수요 확인 후 |

### 기각 (이전 결정 유지 — 새 근거 없음)

| 기능 | 출처 | 이유 |
|---|---|---|
| USD 예산·UVI·잔액 조회 | pi-auto-router | 이 체인의 정책 축은 쿼티 티어(free→daily→…)이지 금액이 아니다. tier표가 정책이라는 단일 출처를 지킨다 |
| 키워드 의도 분류·@단축키·LLM 분류기 | pi-auto-router, ygncode/pi-router, pi-star-router | per-prompt tier는 README에서 이미 기각("one score order, not per-prompt tiers"). 새 근거 없음 |
| 헬스 프로브 (백그라운드 실제 호출) | pi-router | 요청을 소비한다. cooldown의 수동 탈출(`/next`)로 충분 |
| 컨텍스트 요약 전송 | pi-router | Pi 가상 모델이 물리 모델 교체를 네이티브로 처리한다 (virtual-models 문서). 존재 이유가 없다 |
| 뒤로 미루는 백오프 | @cad0p | README 기각 유지 — route() 내 대기는 사용자 가시 지연 |

## 다음 단계

설계 문서(2.1): 위 채택 목록의 책임 배치 — 그룹 정의의 소재(설정 파일? `fallback` 프로바이더 아래 동적 등록?),
전략·친화도가 기존 `cooldown.ts`/`candidates.ts`/`routes.ts`와 만나는 지점, 기존 family route 2개를 그룹 일반화로
대체해 지울 것인지(2.3), 점수순 정책이 "in order 전략"으로 격하되면서 coding-fallback과의 단일 출처가 어떻게 유지되는지.
TUI는 이미 채택된 Magpie 패턴(통합 리스트, J/K, double-tap) 위에 `o`/`s` 순환 키를 얹는다.
