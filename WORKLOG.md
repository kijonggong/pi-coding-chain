# 작업 기록 (Work Log)

작성일: 2026-10-17
저장소: `D:\repository\pi-coding-chain` (GitHub: `kijonggong/pi-coding-chain`, private)
대상 확장: `coding-fallback`, `aaii-router`, `quota-providers`, `openrouter-catalog-filter`

---

## 1. 이 저장소가 왜 생겼나

기존 저장소 `pi-openrouter-catalog-filter`는 이름과 달리 확장 4개를 함께 담고 있었습니다.
그중 `coding-fallback`은 등록 피커·점수 스냅샷·무료 모델 조회까지 커져 사실상 독립 패키지가
됐는데도 같은 매니페스트를 썼기 때문에, 한 확장을 고치면 4개를 함께 재설치해야 했습니다.

`aaii-router`와 `quota-providers`는 `coding-fallback`의 티어표(`providers.ts`), AAII 읽기
(`scores.ts`), `model_list` 파서(`chain.ts`)를 `../coding-fallback/...`로 import 합니다. 즉 셋은
**한 라이브러리와 그 소비자**라서 같은 저장소에 있어야 합니다. `openrouter-catalog-filter`만
공유 코드가 없습니다.

## 2. 옮긴 것

4개 확장 전체 + `package.json`(`pi.extensions` 4개) + 루트 README. 테스트 파일도 함께 옮겼습니다.

## 3. 발견해서 고친 문제

**매니페스트 버그 (커밋 `111dfcc`).** 첫 커밋의 `package.json`이 `extensions/coding-fallback`
하나만 선언했고(패키지 이름도 `pi-coding-fallback`) 그대로 설치되어, 세션에서 `/aaii-router`,
`/quota-providers`, `/openrouter-catalog-filter`가 **명령으로 등록되지 않았습니다**. RPC 실측에서
`/aaii-router`가 `disposition: "started"`로 돌아왔는데, 이는 확장 명령이 아니라 모델에게 일반
메시지로 전달됐다는 뜻입니다. 4개를 모두 선언하고 이름을 `pi-coding-chain`으로 맞춰 해결했습니다.

## 4. 검증 (실제 pi 1.3.0, RPC 모드, 명령마다 새 프로세스)

| 명령 | 결과 |
|---|---|
| `/coding-fallback add` | `handled` — 피커는 TUI 전용이라 RPC에서는 안내 문구 |
| `/coding-fallback nope` | `handled` — `unknown subcommand \`nope\`. Try check, sync, add` |
| `/aaii-router` | `handled` — `198 candidates, scores 2026-10-13 (164 unranked (no AAII score), 17 with no quota tier)` |
| `/quota-providers` | `handled` — `dashscope: 29 models via https://dashscope-intl.aliyuncs.com/compatible-mode/v1 (key from $DASHSCOPE_API_KEY)` |
| `/openrouter-catalog-filter status` | `handled` — `allowlist on (default)` |

`node --test extensions/` → **151개 중 149개 통과**. 실패 2개는 저장소 밖
`~/.pi/agent/litellm_config.yaml`이 2026-10-16 22:40에 교체되어 `dashscope-coding-fallback`
멤버가 없기 때문이며, 이번 이동 전후가 동일합니다. 모든 실측은 임시 사본 설정 + `PI_OFFLINE=1`로
돌려 라이브 설정과 네트워크를 건드리지 않았습니다.

## 5. 설치 상태

- `~/.pi/agent/settings.json`: `git:github.com/kijonggong/pi-coding-chain@main`
  (기존 `...pi-openrouter-catalog-filter@main`은 제거, 설정 백업 `settings.json.bak-20261017-020617`)
- 기존 저장소는 이력으로 남고 설치 목록에서 빠졌습니다. 그 저장소의 `package.json`·`README.md`는
  이동 중 실수로 덮어썼다가 `git checkout --`로 원상 복구했습니다.

## 6. 한계와 다음

- `openrouter-catalog-filter`는 체인과 무관합니다 — 별도 패키지로 분리할 수 있습니다.
- 실제 대화형 TUI(피커 화면)는 여전히 스텁 SDK 테스트로만 검증되었습니다.
- 라이브 LiteLLM 설정에는 `sync` 적용이 필요합니다(미해결 결정).

---

## 7. 추가: 피커 행에 라우터 표시 (같은 이름의 모델 구분)

행이 `☐ <모델 id>`뿐이라 **이름이 같은(접두사만 다른) 모델을 구분할 근거가 없었습니다**
(`z-ai/glm-5.3-flash`와 `glm-5.3-flash`는 그룹 이름이 같게 나옵니다). 그래서 행이 어느
라우터의 모델인지 함께 보여줍니다:

- **목록을 읽은 경우**: 고른 업스트림 이름(slug, 없으면 host) — 예 `☐ nvidia/deepseek-v4.1-flash`
- **폴백 목록일 때**: 그 id를 **이미 서비스하는** 업스트림 (둘이면 `·`로 연결) — 예 `☐ explabs·nvidia/glm-5.3-flash`.
  이 id들은 목록이 없어서 설정만이 출처를 말해 줍니다.
- 비교 키는 패키지가 쓰는 정규화(점·대시·대소문자)를 그대로 씁니다.

검증: `catalog.test.ts` 19/19, `picker.test.ts` 10/10, 패키지 전체 **157개 중 155개**(실패 2개는
라이브 설정 드리프트). 실제 SDK(`SelectList`/`Input` + `initTheme`) 렌더 실측:

```
→ ☐ zai/z-ai/glm-5.3-flash        AAII 41.8
  ☐ zai/glm-5.3-flash             AAII 41.8
  ☐ nvidia·explabs/deepseek-v4.1  no AAII score — it would sort last
```

## 8. 추가: ExpLabs 무료 모델 2개 등록 + 빈 체인 허용

요청: "explabs에 muse spark open과 deepseek v4.1 uncensored가 무료가 됨. coding fallback에 추가."

### 8.1 그 "무료"는 리스팅에 없습니다

`/v1/models`(297개)를 그대로 읽으면 둘 다 **유료**입니다: `muse-spark-open` $1.24/$4.24,
`deepseek-v4.1-flash-uncensored` $0.30/$1.20(비-uncensored와 동일). 입력·출력이 모두 0인
채팅 모델은 **0개**입니다. 그런데 실제 호출은 다릅니다:

| 모델 | 1토큰 호출 결과 |
|---|---|
| `muse-spark-open` | **200**, `usage.cost: 0` (provider `wally`) |
| `muse-spark-1.3`, `deepseek-v4.1-flash`, `deepseek-v4-flash` | 429 `insufficient_credits` (잔액 -14.71) |
| `deepseek-v4.1-flash-uncensored` | 502 (Cloudflare, text/plain) — 3회 모두 |

즉 이 계정에서 무료 여부를 말하는 신호는 리스팅의 `pricing`이 아니라 **실제 청구 결과**였습니다.
`muse-spark-open`만 크레딧 0 상태에서도 통과하며 청구가 0입니다. 두 번째 모델은 라우트 자체가
고장나 있어 무료인지 확인할 수 없고, 지금 호출하면 실패합니다(유료 모델의 JSON 429와도 다름).

### 8.2 자동 감지·자동 추가는 있고, 이번 건을 못 봅니다

- 감지: 세션 시작 시 `refreshFreeSnapshot`이 각 업스트림 `/models`를 프로브해 `free-models.json`에
  캐시(`sync`는 `--force`).
- 추가: `sync`/`add` 때 `reconcileFreeEntries`가 `code-free-<slug>-<id>` 그룹을 만들고, `orderChain`이
  그 모델의 티어를 `free`로 올려 체인 앞쪽에 넣습니다.
- **기준이 리스팅 `pricing` == 0**이라 이번 두 모델은 대상이 아닙니다(스냅샷 `free: []`).
  사용자 결정: **감지 기준은 pricing만 유지**(요금 프로브 추가 안 함), 두 모델은 손으로 등록.

### 8.3 라이브 설정이 컴포저를 거부하던 문제

`check`가 계속 `was not understood — no model_list entries match chain "dashscope-coding-fallback"`로
실패했습니다. 10-16에 라이브 설정이 3그룹으로 줄어 `ds-` 멤버가 사라졌고 컴포저는 모든 체인에
멤버를 요구했습니다. 고친 방식:

- `composeCodingFallback`: 멤버가 없는 체인은 **건너뛰고**, 어느 체인에도 속하지 않는 이름만 있으면
  (`no model_list entries match "coding-fallback" or "dashscope-coding-fallback"`) 여전히 거부.
- `chain.test.ts`: 체인 생략 테스트 + "어느 체인에도 안 속하면 거부" 테스트 추가.
- `config.test.ts`: 기존 거부 테스트 2개의 픽스처를 "ds- 없음"에서 "이름이 어느 체인에도 없음"으로
  바꾸고, 손질된(체인 하나뿐인) 설정에 등록이 성공하는 테스트를 추가.

### 8.4 등록 결과

`addModels`(확장의 `add` 경로, 백업 자동)로 1회 쓰기:

```
code-8-explabs-muse-spark-open              model: openai/muse-spark-open
code-9-explabs-deepseek-v4.1-flash-uncensored
coding-fallback: code-2-nvidia → code-4-explabs → code-7-qwen3.8 → code-8 → code-9
```

둘 다 AAII 점수가 없어 **맨 뒤**에 붙습니다(정책: 점수 우선, 미채점은 뒤). 백업
`litellm_config.yaml.bak-2026-10-17T00-23-42-163Z`, `check`는 이후 `up-to-date`,
스냅샷은 `2026-10-17T00:23:32Z`(0 free)로 갱신했습니다.

새 그룹이 `quota-providers`의 "라이브 설정 타깃은 모두 설명되어야 한다" 불변식을 깨서
`EXPLABS.models`에 두 모델을 추가했습니다(`muse-spark-open`은 게시가와 실제 청구가가 다르다는
점을 주석으로 남김).

### 8.5 검증과 한계

- `node --test extensions/` → **160개 중 160개 통과**.
- 한계: ⑴ 무료 판정을 리스팅 가격으로 유지하기로 했으므로 이번 같은 케이스는 계속 수동 등록,
  ⑵ `deepseek-v4.1-flash-uncensored`는 현재 502라 첫 호출이 실패하고 쿨다운됩니다,
  ⑶ 실제 터미널 TUI는 여전히 실사용 확인 전, ⑷ **푸시·설치본 갱신은 사용자 승인 대기** —
  설치본(`e67472e`)은 아직 빈 체인을 허용하지 않아 새 라이브 설정에서 경고를 냅니다.
- 편집이 처음엔 세션 루트인 옛 저장소(`pi-openrouter-catalog-filter`)에 들어가 되돌리고 여기로
  옮겼습니다. 이후 이 저장소에서만 작업합니다.

### 8.6 점수 부여: 둘 다 "39점"의 실제 근거

사용자 제보: 새로 추가한 두 모델이 모두 AAII 39점. AA 미러에서 직접 확인한 결과는 이렇습니다.

| 모델 | AA 미러 | 기록한 값 |
|---|---|---|
| `muse-spark-open` | `meta/muse-spark-open` 존재 — **38.9**, variant "Muse Spark Open (Xhigh)", 2026-10-16 레코드 | 38.9 (반올림하면 39 — 파일은 AA의 원값을 적습니다) |
| `deepseek-v4.1-flash-uncensored` | **항목 없음** (`deepseek/` 폴더에 uncensored 계열 없음) | `aliases`로 베이스 `deepseek-v4.1-flash`(39.5)에 연결, `aliasNotes`에 근거 기록 |

`fetch-scores.mjs`의 `TARGETS`에도 두 키를 넣었습니다. `scores`는 스크립트가 재생성하므로
여기에 넣지 않으면 다음 새로고침이 손으로 적은 항목을 지웁니다(`aliases`·`aliasNotes`는 원래
carry-forward). `retrieved`는 마지막 **전체** 갱신일(2026-10-13) 그대로 두었습니다 — 27개 중
하나를 손으로 더한 것이라 파일 전체 나이를 오늘로 낮추면 거짓이 됩니다.

`sync` 적용 결과(백업 `litellm_config.yaml.bak-2026-10-17T00-29-18-013Z`, `check` up-to-date):

```
head  code-2-nvidia-deepseek-v4.1-flash         39.5 (daily)
      code-4-explabs-deepseek-v4.1-flash        39.5 (monthly)
      code-9-explabs-deepseek-v4.1-flash-uncensored  39.5 (별칭으로 베이스 점수)
      code-8-explabs-muse-spark-open            38.9
      code-7-qwen3.8-flash-next-iq3_s           미채점 → 마지막
```

미채점은 이제 code-7 하나뿐입니다. `node --test extensions/` → **160개 중 160개 통과**.

## 9. 추가: Magpie routing 채택 기능을 aaii-router에 접붙임 (groups·strategy·affinity·explain·에스컬레이션)

작성일: 2026-10-31 · 설계 `_research/routing-groups-design.md`, 처분 근거
`_research/routing-extension-survey.md`, 구현 보고 `_research/groups-impl-report.md`.

### 9.1 바꾼 책임 소재와 구조

routes.ts(하드코딩 family route 2개 + full chain)를 groups.ts(설정 파일이 출처인
라우팅 그룹)로 대체하고, 전략·친화도·결정 설명·반복 실패 에스컬레이션을 각자의
책임 자리에 두었습니다: 그룹 정의와 매처는 `groups.ts`, 분배 전략은 `strategy.ts`,
친화도 선택은 `cooldown.ts`의 `chooseTurnCandidate`, 실패 창 연장은
`cooldown.ts`의 `rememberFailure`, 결정 기록·표시는 `explain.ts`(신설) + `index.ts`
기록, 설정 읽기·검증은 `settings.ts`, 등록·명령·조율은 `index.ts`.

### 9.2 더한 것 / 뺀 것

**더한 것**: `groups.ts`·`strategy.ts`·`explain.ts` 신설(각각 시험 파일 포함),
settings 키 `strategy`·`affinity`·`groups`(환경변수 `PI_AAII_ROUTER_STRATEGY/
_AFFINITY/_GROUPS`), `/aaii-router explain`, 쿨다운 반복 실패 창 연장(상한 4배)과
`hits` 표기, `chooseTurnCandidate`의 affinity 매개변수.

**뺀 것**: `routes.ts`·`routes.test.ts` 삭제(2.3). `ROUTES`·`RouteDefinition`·
`candidatesForRoute` 소멸 — 소스 참조 0건 확인. `strategy.ts`의 `takeHead`는
fresh-turn 경로가 `chooseTurnCandidate`의 결과를 직접 쓰면서 불필요해져
`recordServed`(least-used served 카운트만)로 대체·삭제. `applyStrategy`의
`excludedModels` 매개변수는 `applyChainSettings`가 이미 처리하는 것의 재적용이라
만들지 않았고(`manual`용 `pinnedModels`만), 이로써 호출 지점(`index.ts` routeFor·
next)은 전부 groups API로 함께 고쳤습니다. `settings.ts`에는 `routingChanged`의
groups identity 비교 버그를 고치면서 3키를 추가했습니다.

**처분 라운드에서 추가로 뺀 것(§9.8)**: `RouterState.strategyName` 필드·읽기·쓰기
소멸 — 설정보다 state의 옛 전략이 이기는 결함(C-2). 등록 팩토리의 `parseGroup`
재검증 루프·`registrationNotes` 소멸 — 도달 불가능한 과잉 방어(2.7).

### 9.3 3절 형태를 쓴 곳

없음. 대체된 routes 경로는 지웠고, 같은 일을 하는 길은 하나
(`groups.ts` → `index.ts`)뿐입니다. 등록 팩토리의 `parseGroup` 재검증 루프는
처분 라운드에서 도달 불가능한 과잉 방어(2.7)로 확인돼 제거했습니다 — `groups` 값은
항상 `parseGroupsValue`를 통과하므로 `parsed.settings.groups`를 그대로 등록합니다.

### 9.4 시험 계약과 mutation check

- `groups.test.ts`: 매처는 옛 `routes.test.ts`의 계약을 그대로 이어받습니다
  (접두·접미·변이 안, 다른 버전 밖, `:free` 접미 처리) + 그룹별 후보 단축과 tier
  정렬, `parseGroup` 검증(id 예약·비-canonical match·잘못된 strategy/affinity 거부,
  name 기본값), DEFAULT_GROUPS.
- `strategy.test.ts`: 전략별 기대 순서, rotate의 턴 진행과 wrap, retry 재계산이
  실패한 턴의 순서를 재현하는 것(저장 카운터 −1), rotate 오프셋 note, least-used의
  served 카운트와 동률 시 체인 순서, free-first의 티어·점수 전체 동률 label
  tiebreak, manual의 pin 없음 note와 강등, exclusion이 모든 전략에 적용(전략은
  주어진 목록만 재정렬).
- `cooldown.test.ts` 확장: 창 안 재실패 → until 연장 + hits 증가, 상한 4배, 창 만료
  뒤 실패는 새 창, describeCooldown 반복 표기, affinity 3종.
- `settings.test.ts` 확장: strategy/affinity 단어 검증 + env override, groups JSON
  파싱(잘못된 항목 note + 좋은 항목 생존, 중복 id·aaii 예약 거부), groups가
  PROJECT_KEYS 밖, serialize→parse 라운드트립. 기존 "writes a file it can read back"
  테스트의 직렬화 키 목록 단정은 **기준 완화가 아니라 계약 갱신**입니다 — 파일이 이제
  `strategy`·`affinity`·`groups` 3키를 더 쓰기 때문입니다.
- `index.test.ts`: 하네스 모듈에 groups/strategy/explain 추가(routes 제거), 등록
  그룹 검증, explain 서브커맨드, affinity=turn이 매 새 턴 선두로 돌아오는 것.
  기존 계약 유지: `[aaii-router/glm-5.3-flash] no eligible model` 문구, 상태줄
  `aaii → label` 형식.

**mutation check(예비)**: ① rotate 오프셋 +1 → 3개 실패, ② least-used 내림차순 →
1개 실패, ③ manual 강등 note 제거 → 1개 실패, ④ 창 연장 상한 제거 → 1개 실패,
⑤ 만료 창의 hits 재사용 → 1개 실패, ⑥ affinity=turn 무시 → 2개 실패, ⑦ aaii
예약 해제 → 2개 실패, ⑧ routingChanged identity 비교(실제 발견 버그) → 2개 실패.
모두 원복 후 전체 통과 재확인. 실제 mutation check는 별도 레인에서 다시 돌아갑니다.

### 9.5 동작 보존 / 의미 변경

**의미 변경**: 기본 2개 family route가 하드코딩에서 설정 파일 출처로 바뀌었고(기본
시드가 같아 관찰 동작은 동일), rotate·least-used·manual 전략과 session/turn
친화도, explain, 창 연장은 새 동작입니다. 연장 상한 4배는 무한 연장이 한 모델을
사실상 영구 제외하기 때문입니다. **동작 보존**: order 전략(기본)은 기존 정책 순서
그대로이며 coding-fallback과의 체인 일치가 변하지 않습니다. continuation/retry의
stickiness와 쿨다운 1창 동작도 그대로입니다.

### 9.6 검증

`PI_OFFLINE=1 PI_CODING_FALLBACK_FREE_REFRESH=off node --test extensions/*/*.test.ts`
→ **280개 중 280개 통과**. `grep -rn "routes.ts|RouteDefinition|candidatesForRoute|
ROUTES" extensions/aaii-router` → 소스 0건(README의 시험 서술은 groups.test.ts로
갱신).

### 9.7 열린 질문 (설계가 애매했던 결정과 선택)

- `groups` 부분 생존: 파일의 groups 배열에서 일부 항목만 잘못돼도 좋은 항목을
  적용하고 note로 남기기로 했습니다(설계 §8의 "note + 생존"을 파일·환경 경로까지
  확장). 전부 무효면 빈 목록이 적용됩니다 — operator가 굳이 비운 것이므로.
- 전략 적용 시점: 회전은 새 유저 턴에서만 전진하고, retry는 저장된 카운터에서 1을
  되돌려 실패한 턴이 출발한 순서를 걷습니다(§9.8 R-P0-1).

### 9.8 처분 라운드: 독립 리뷰·mutation 재검증 (2026-10-31)

독립 리뷰 11건 + 코디네이터 확인 8건을 정본 절차 3단계로 처분했습니다
(`_research/dispositions-groups.md`): **수정 13 / 기각 5 / 부채 기록 2**, mutation
18변이(16 kill / 2 survive). 반영한 "수정" 항목:

- **R-P0-1 + R-P2-1**: retry가 실패한 턴과 다른 순서를 걸어 남은 후보가 있어도
  "chain exhausted"로 죽는 결함 — retry 경로가 저장 state.turns에서 1을 되돌린
  상태로 순서를 재계산. index.test.ts가 실제 생산자→소비자 연결(fresh turn의 반환
  state를 그대로 retry 입력으로)을 재현하고, strategy.test.ts의 재주입 전제 시험을
  실제 단정(저장 카운터 −1 재계산)으로 교체.
- **C-2**: `strategyName` 필드·읽기·쓰기 제거 — 전략은 매 요청
  `groupStrategy(group, settings)`로 결정해 `/aaii-router set strategy`가 즉시
  반영된다. continuation·retry의 전략 카운터 보존 구조는 유지.
- **R-P1-1**: `DecisionReason` type import 추가. **R-P1-2**: groups 부분 거부
  note를 dialog·`set` 두 경로에서 notify.
- **R-P2-2**: explain.ts의 죽은 `chosen` 매개변수·읽는 곳 없는 `when` 필드 제거,
  `lastDecision` 주석을 실제 소비자 기준으로 교정.
- **R-P2-3**: 등록 팩토리 재검증 제거(§9.3). **R-P2-4**: retry·continuation도
  실제 응답자로 `recordServed`(stick의 단일 커밋 지점에서 적용) — least-used가
  설계 §3대로 실제 응답한 후보를 센다. rotate의 turns는 보존.
- **R-P2-5**: rotate 오프셋 note(`rotate: starting at position N`) — README·설계가
  주장한 내용이 실제가 됨. **R-P2-6**: routingChanged groups 비교를 [id, match,
  name, strategy, affinity] 튜플 정규화 + id 정렬로 변경(키 순서 무관, M9 시험 유지).
  **R-P2-7**: 미사용 `preferred`·`FULL_CHAIN_ID` import 제거,
  `containsImage` 1회 계산.
- **IL-TYP-301**: `group.match!` 단언 제거(지역 변수 narrowing).
  **IL-ARC-205**: settings.ts의 strategy/affinity 나열을 strategy.ts·cooldown.ts의
  `STRATEGIES`·`AFFINITIES`에서 파생(단일 출처), groups.ts의 거부 문구도 동일.
- **R-P2-8 + M-E3 + M-E8**: 시험 보강 — per-group strategy/affinity override
  (index.test.ts 2건), coolingDescriptions 임박순 정렬(explain.test.ts 신설),
  free-first 전체 동률 label tiebreak(strategy.test.ts).

**E3/E8 mutation 재확인**: 임시 사본에서 ① coolingDescriptions의 until 정렬 제거,
② free-first label tiebreak 제거(`localeCompare` → `return 0`)를 다시 만들자 새
시험이 각각 실패 — 둘 다 **kill**. 사본은 삭제했고 원본 트리는 변이 없음.

**재검증**: `PI_OFFLINE=1 PI_CODING_FALLBACK_FREE_REFRESH=off node --test
extensions/*/*.test.ts` → **287개 중 287개 통과**. `grep strategyName
extensions/aaii-router/*.ts` → 0건, `grep registrationNotes index.ts` → 0건.
설계 문서(`_research/routing-groups-design.md`)의 strategyName·least-used 집계·
재검증 문구도 실제에 맞게 갱신.

### 9.9 aggregator 공급자 기본 제외 + 실물 검증 (11-01)

**실물 검증(완료 정의 3단계)**: pi 1.4.0 RPC 모드에서 작업 트리 확장을 단독 로드해 실제
요청 8턴 소비. rotate+turn 전략에서 실제 응답 모델이 턴마다 순환(magpie/auto →
magpie/nvidia), family 그룹은 42 후보를 glm family 7개로 단축, manual은 pin만 순회,
죽은 로컬 provider를 pin 선두에 두니 연결 실패 → `retry after failure`로 다음 후보에
폴백하고 실패 후보가 `cooling 5m, error`로 기억됨. explain이 전 과정을 기록. 원문
`_research/rpc-a-run-{a,b,d,g}.jsonl`.

**aggregator 기본 제외(사용자 결정)**: "Magpie, openrouter 같은 공급자의 모델은 이 체인의
후보에서 제외" — 라우터를 라우터의 후보로 넣는 우회를 없앤다.

- 더한 것: `candidates.ts`의 `DEFAULT_EXCLUDED_PROVIDERS = ["magpie", "openrouter"]`(신설
  상수, 단일 출처). `DEFAULT_SETTINGS.excludedProviders`가 재사용. 설정 파일에 빈 값을 쓰면
  되돌릴 수 있다.
- 뺀 것: 기본값의 빈 제외 목록(대체됨).
- 라이브 설정(`~/.pi/agent/aaii-router.json`)의 `providers`에 `magpie` 추가(사용자 설정,
  백업 `aaii-router.json.bak-20261101`). openrouter는 이미 제외 중.
- 시험: settings.test.ts의 기본값 단정을 새 계약으로 갱신(완화 아님) — 291개 중 291개 통과.
- README: 설정 표의 `providers` 기본값·이유 갱신.
- 의미 변경: 기본 후보 집합이 줄어든다. magpie/openrouter를 쓰던 세션은 설정으로 되돌려야 한다.
