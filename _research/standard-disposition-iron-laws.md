# 정본 검증 처분 기록 — Iron Laws 지적 (feat/aaii-fallback-editor)

정본: `~/.claude/skills/engineering-standard/references/standard.md` (저장소 사본 `docs/engineering-standard.md`와 같은 판정 기준).
절차: engineering-standard 스킬의 검증 절차. 이번 요청의 범위는 **Iron Laws 지적 50건의 처분과 그에 따른 수정**이다.

## 0. 범위

- 브랜치 `feat/aaii-fallback-editor`, 기준 `main`(`4861f9d`). 커밋하지 않은 변경은 `docs/engineering-standard.md`의 도구 주소
  한 줄과 추적하지 않는 `_research` 파일뿐이다.
- 이 브랜치의 독립 리뷰·mutation check·재리뷰·최종 확인은 이미 끝났다(`standard-disposition-aaii-fallback.md`). 그때 Iron Laws
  단계만 도구가 없어 빠졌으므로, 2.11("검증 재사용 여부는 변경 범위와 입력·계약의 동일성으로 판단")에 따라 앞선 리뷰는
  재사용하고, 이번 수정에 대해서만 재리뷰·최종 확인을 받는다.

## 1. Iron Laws 실행

- `iron-laws v1.9.0`, `iron-laws audit . --format json -o _research/iron-laws-aaii-fallback.json`
- 결과: 65개 파일, 등급 **D**, `scan_status` complete, 지적 **50**건(CRITICAL 0 / HIGH 9 / MEDIUM 29 / LOW 12), 억제 0.
  `unverified_rule_language_rate` 0.69(규칙·언어 조합의 69%는 양성·음성 시험이 모두 있지는 않음 — 지적 없음이 곧 문제 없음은 아니다).
- `iron-laws check . --changed-since main`: **50건 모두** main 이후 바뀐 파일에 있다. 정본 2.10의 "바뀐 코드의 지적"이므로
  "범위 밖" 부채로 미룰 수 있는 것은 없다. 전부 수정 또는 근거 있는 기각이다.

## 확인한 사실 (처분 근거)

- **Pi SDK의 `ctx.ui.setStatus`는 예외를 던지지 않는다.** 선언은 `setStatus(key, text): void`(`pi-coding-agent/dist/core/extensions/types.d.ts:84`).
  UI가 없는 모드는 no-op 구현(`setStatus:()=>{}`)이고, RPC 모드는 메시지를 내보낼 뿐이다. 따라서 aaii-router의 상태 줄 `try/catch`
  두 곳은 일어날 수 없는 실패를 막는 방어(2.7)다.
- `fileURLToPath(import.meta.url)`는 `file:` 모듈에서 실패하지 않는다. aaii-router의 같은 함수(`index.ts:202`)는 감싸지 않았다.
- `fetch-scores.mjs:174-176`의 주석은 "aliases를 `{}`로 시작하면 수동 별칭이 조용히 지워진다"고 경고하는데, `:177-178`은 기존 파일을
  읽지 못하거나 JSON이 깨졌을 때 정확히 그렇게 한다(`.catch(() => "")` → `aliasMapsFromSnapshot`이 `{}` 반환 → 새 파일 쓰기).
- `loadScores`(`scores.ts:108-115`)는 파일이 없을 때와 깨졌을 때를 구분하지 않고 빈 표를 돌려준다. `coding-fallback sync`
  (`config.ts:170`)는 그 표로 체인을 정렬해 실제 LiteLLM 설정에 쓴다.
- 무료 모델 스냅샷을 못 읽으면 "no free-model snapshot could be read, so model_list was left exactly as found"로 알린다(`config.ts:57`).
- on/off 값을 못 읽으면 호출자가 메모로 보고한다(`settings.ts` `editSetting`의 "expected on or off", `state.ts:88`, `:113`).
- 같은 지식의 중복(코디네이터가 코드를 읽어 찾음, 도구는 일부만 지적):
  - ExpLabs 주소 `https://api.experientiallabs.ai/v1`이 `coding-fallback/free-models.ts:61`과 `quota-providers/catalog.ts:137`에 있다.
  - URL → origin 정규화(`${protocol}//${host}`)가 `aaii-router/candidates.ts:56`과 `aaii-router/settings.ts:166`에 따로 있다. 설정에서
    정규화한 값과 모델 baseUrl에서 뽑은 값을 비교하므로, 둘이 어긋나면 제외가 조용히 안 먹는다. URL → host도
    `candidates.ts:66`과 `coding-fallback/chain.ts:137`에 따로 있다.
  - 점수표 기본 경로와 환경 변수 `PI_CODING_FALLBACK_SCORES`가 `coding-fallback/index.ts:93-95`와 `aaii-router/index.ts:206-208`에 따로 있다
    (aaii-router는 `"..", "coding-fallback", "aaii-scores.json"`으로 남의 디렉터리 구조를 안다).

## 처분표

ID는 `IL-NN`(도구 지적, 규칙·파일·줄 순 정렬 번호)과 `C-N`(코디네이터 발견)이다.

### 수정

| ID | 규칙 | 위치 | 요지 | 처분 | 담당 |
|---|---|---|---|---|---|
| IL-28 + IL-35 (D1) | IL-301 | `fetch-scores.mjs:177`, `scores.ts:137` | 기존 점수 파일을 못 읽거나 JSON이 깨지면 수동 별칭을 `{}`로 지우고 덮어씀 | **수정** — 파일 없음(ENOENT)만 "별칭 없음", 그 밖의 읽기 오류와 깨진 JSON은 이유를 들고 중단(쓰지 않음) | W1 |
| IL-27 | IL-301 | `fetch-scores.mjs:125` | 색인 레코드를 못 읽으면 조용히 건너뜀 | **수정** — 건너뛴 파일과 이유를 출력(CLI 스크립트) | W1 |
| IL-34 (D2) | IL-301 | `scores.ts:112` | 깨진·못 읽는 점수 파일을 빈 표로 바꿔, sync가 점수 없는 순서를 실제 설정에 씀 | **수정** — 파일 없음은 문서화된 대로 빈 표, 깨졌거나 못 읽으면 경로와 이유를 담은 오류. 호출자(`config.ts` sync, aaii-router `registry`, coding-fallback 점수 조회)는 그 오류를 그대로 드러낸다 | W1 |
| IL-32 (D3) | IL-301 | `coding-fallback/index.ts:83` | 실패할 수 없는 `fileURLToPath`를 감싸고 `process.cwd()`로 대체 | **수정** — try/catch 삭제 | W1 |
| IL-16 + C-3 | ARC-205 | `aaii-router/index.ts:206-208` | 점수표 기본 경로·환경 변수를 aaii-router가 다시 앎 | **수정** — coding-fallback이 경로 해석을 하나로 소유하고(모듈 기준 상대 경로), aaii-router는 그것을 import. aaii-router의 `scoresPath` 삭제 | W1 |
| IL-03 + IL-07 + C-1 | AI-101 | `free-models.ts:61`, `quota-providers/catalog.ts:137` | ExpLabs 주소 중복 | **수정** — 한 곳에 정의하고 다른 쪽은 import(의존 방향은 quota-providers → coding-fallback 유지) | W1 |
| IL-19 + IL-20 + IL-23 + IL-26 + C-2 | IL-301, 2.4 | `candidates.ts:56,66`, `settings.ts:166`, `chain.ts:137` | URL → origin/host 정규화가 세 군데 | **수정** — 하나로 합친다(파싱 실패는 `undefined`; 호출자가 의미를 정함: 설정은 거부 사유 보고, 후보는 "출처 없음", 체인은 미분류). 중복 함수 삭제 | W1 |
| IL-21 + IL-22 | IL-301 | `aaii-router/index.ts:337`, `:725` | 예외를 던지지 않는 `setStatus`를 try/catch(+ `?.` 사슬)로 감쌈 | **수정** — try/catch와 불필요한 `?.` 삭제(앞선 처분 기록에서 "부채"로 미뤘던 것을 이번에 처리) | W1 |
| IL-25 | IL-301 | `aaii-router/settings.ts:483` | 설정 파일을 읽지 못하면(권한 등) 조용히 기본값 | **수정** — ENOENT만 "파일 없음", 그 밖의 오류는 경로·이유와 함께 드러냄 | W1 |
| IL-49 | TYP-301 | `coding-fallback/picker.ts:151` | `has` 검사 뒤 `get(id)!` | **수정** — 단언 없이 같은 동작 | W1 |
| IL-36 + IL-37 | IL-301 | `openrouter-catalog-filter/index.ts:207`, `:226` | 원격 → 저장본 → 내장 대체 순서에서 실패 이유가 사라짐 | **수정** — 대체 순서(오프라인 동작을 위한 설계)는 유지하되, 건너뛴 출처와 이유를 `LoadedCatalog`에 담아 status·list에 보여 줌 | W2 |
| IL-39 | IL-301 | `openrouter-catalog-filter/state.ts:171` | 상태 파일을 읽지 못하면(권한 등) 조용히 기본값 | **수정** — ENOENT만 "파일 없음", 그 밖의 오류는 메모로 보고 | W2 |
| IL-50 | TYP-301 | `openrouter-catalog-filter/index.ts:213` | `as unknown as unknown[]` 이중 캐스트 | **수정** — `applyAllowlist`가 `readonly unknown[]`을 받게 하고 캐스트 삭제(2.2 감쌌다 풀기) | W2 |

### 근거 있는 기각 (의도된 계약 · 오탐)

| ID | 규칙 | 위치 | 처분 | 근거 |
|---|---|---|---|---|
| IL-24 | IL-301 | `settings.ts:263` | 의도된 계약 | 깨진 JSON을 note로 보고하고 기본값을 쓴다고 알린다(`"the settings file is not valid JSON; defaults are in force"`) |
| IL-38 | IL-301 | `state.ts:78` | 의도된 계약 | 같은 방식으로 note를 돌려준다 |
| IL-29 | IL-301 | `free-fetch.ts:78` | 의도된 계약 | 이전 스냅샷은 "변화 여부" 비교에만 쓰인다. 읽지 못하면 새로 조회한 스냅샷으로 대체하고, 쓰기 실패는 따로 보고한다(`free-fetch.ts` 쓰기 경로) |
| IL-30, IL-33 | IL-301 | `free-models.ts:299`, `scores.ts:77` | 의도된 계약 | 파싱 API의 `undefined`는 "쓸 수 있는 스냅샷 아님"이며 호출자가 결정한다. 문제는 호출자 쪽(IL-34)에서 고친다 |
| IL-31 | IL-301 | `free-models.ts:328` | 의도된 계약 | 스냅샷을 못 읽으면 model_list를 그대로 두고 그 사실을 알린다(`config.ts:57`). 결과가 보수적이고 사용자에게 드러난다 |
| IL-40–43, IL-46, IL-47 | IL-307 | `settings.ts:179–192`, `state.ts:43–44` | 의도된 계약 | `undefined`는 "알아볼 수 없는 값"이고 모든 호출자가 이유로 바꿔 보고한다(`editSetting`, `state.ts:88`, `:113`) |
| IL-44 | IL-307 | `chain.ts:261` | 의도된 계약 | `fallbacks` 블록에 그 체인이 아직 없으면 "기존 순서 없음"이 정확한 값이다. 블록 자체가 없으면 compose가 먼저 거부한다 |
| IL-45 | IL-307 | `scores.ts:80` | 의도된 계약 | IL-30과 같다(파싱 API). 호출자 문제는 IL-34 |
| IL-01 | AI-101 | `candidates.ts:54` | 의도된 계약 | LiteLLM 프록시 기본 주소이고 설정(`origins`)으로 바꿀 수 있는 기본값이다. 이름이 붙은 상수 한 곳 |
| IL-02, IL-05, IL-06 | AI-101 | `fetch-scores.mjs:39`, `openrouter-catalog-filter/index.ts:46`, `quota-providers/catalog.ts:105` | 의도된 계약 | 환경마다 바뀌는 개발 주소가 아니라 외부 서비스의 고정 공개 엔드포인트이며, 각각 이름 붙은 한 곳에 있다 |
| IL-04 | AI-101 | `providers.ts:41` | 의도된 계약 | 운영자의 LiteLLM 설정을 분류하는 tier 표의 데이터다(출처 주석 포함). 주소가 바뀌면 그 host는 "미분류"로 보고된다 |
| IL-08–13 | ARC-201 | `aaii-router/index.ts:1, 527, 598`, `free-fetch.ts:88`, `coding-fallback/index.ts:217`, `openrouter-catalog-filter/index.ts:247` | 기각 | 정본 2.1은 줄 수를 맞추려는 기계적 분할을 금지한다. 직접 읽은 결과 `addWithWindow`와 `refreshFreeSnapshot`은 순서대로 진행하는 흐름 하나이고 순수 계산은 이미 분리되어 있다(`claimNames`, `validate*`, `describeBatch`, `buildFreeSnapshot`, `payloadOf`). 확장 진입 파일과 명령 처리기는 2.6의 imperative shell이며, 규칙은 이미 `settings`·`chain-order`·`candidates`·`cooldown`·`fallback-editor`로 나가 있다 |
| IL-14 | ARC-204 | `settings.ts:189` ↔ `state.ts:41` | 기각 | 서로 다른 확장이 각자 문서화한 설정 어휘를 읽는다(aaii-router는 on/true/yes/1, openrouter-catalog-filter는 enable/disable도 받음). 합치려면 무관한 두 확장 사이에 의존을 만들거나 공용 모듈을 새로 만들어야 한다(2.1 결합도, 3절). 어휘가 다르다는 점은 사용자에게 보이는 차이로 기록한다 |
| IL-15 | ARC-204 | `register.ts:189` ↔ `:223` | 오탐 | 구조만 같고 검사하는 필드·패턴·메시지가 다르다. 합치면 전달만 하는 간접화가 된다(2.2) |
| IL-17 | ARC-205 | `fetch-scores.mjs:67` | 오탐 | 반복된 것은 모델 slug 데이터(색인 표와 스냅샷)이지 코드 상수가 아니다 |
| IL-18 | IL-111 | `listing.ts:31` | 오탐 | 주석은 `os.environ/NAME` 문법을 설명할 뿐 비밀 값이 아니다 |
| IL-48 | PERF-102 | `settings.ts:211` | 기각 | 운영자가 쉼표로 적는 origin 몇 개를 도는 반복이다. 크기가 커질 경로가 없다 |

억제 주석은 넣지 않는다. 기각한 지적은 이 표가 처분 근거이며, 등급을 올리려고 억제하거나 기준을 낮추지 않는다(정본 2.10).

## W1 결과 확인 (코디네이터)

- 시험 직접 실행: aaii-router + coding-fallback + quota-providers **212 pass / 0 fail / 0 skip**.
- 덧대기 훑기: 제품 코드에 SDK import 감싸기·`process.cwd()`·절대 경로·빈 `catch {}`·억제 주석 없음. 시험의 동적 import(임시 사본
  불러오기)와 `as unknown as Theme`/`ExtensionCommandContext`(외부 경계 대역 형 맞춤)는 정당.
- 중복 제거 확인: URL 파싱은 `coding-fallback/providers.ts` `parseProviderUrl` 하나, `settings.ts` `originOf`는 그 위에 http(s) 검사만
  얹음. aaii-router의 coding-fallback 경로 하드코딩 없음. ExpLabs 주소는 `free-models.ts` `EXPLABS_BASE_URL` 하나, quota-providers가 import.
- W1이 보고한 재실행 잔여 지적(최종 처분은 재실행 뒤 이 문서에서):
  `providers.ts:116` IL-307, `providers.ts:120` IL-301(파싱 API의 `undefined` — 의도된 계약), `free-models.ts:58` AI-101(단일 정의).
- 의미 변경(W1 보고): 깨진·못 읽는 점수 파일이면 라우팅과 check/sync/add가 이유를 들고 멈춤, 별칭 파일이 깨졌으면 점수 갱신 스크립트가
  쓰지 않고 중단, 설정 파일의 ENOENT 외 읽기 오류가 드러남.

| ID | 정본 | 위치 | 요지 | 처분 |
|---|---|---|---|---|
| N1 | 2.4 | `free-models.ts:62` | `host: "api.experientiallabs.ai"`가 바로 위 `EXPLABS_BASE_URL`에서 계산 가능한 값을 다시 적음 | **수정** — `parseProviderUrl`로 계산하거나 host 필드를 baseUrl에서 도출 |
| N2 | 2.11 | `free-models.ts:52-58` | `FREE_PROBE_TARGETS`를 설명하던 주석이 `EXPLABS_BASE_URL` 위로 떨어져 대상과 어긋남 | **수정** — 주석을 원래 대상 위로 |

## N1·N2, W2 결과 확인 (코디네이터)

- N1·N2: `free-models.ts`의 host를 `parseProviderUrl(EXPLABS_BASE_URL).hostname`으로 계산, 주석은 `FREE_PROBE_TARGETS` 위로 복원.
  상수 URL을 모듈 로드 때 검사하는 `throw`는 non-null 단언 없이 좁히기 위한 것이라 정당. coding-fallback + quota-providers 118 pass / 0 skip.
- W2: openrouter-catalog-filter 13 pass / 0 skip. 대체 순서(원격 → 저장본 → 내장)는 유지하고 건너뛴 출처와 이유(ENOENT·읽기 오류·깨진 JSON·
  허용 모델 없음·네트워크 오류·`PI_OFFLINE`)를 `LoadedCatalog.skipped`에 담아 status/report와 on/off 줄에 표시. `list`는 그대로(2.5).
  `applyAllowlist`가 `readonly unknown[]`을 받고 이중 캐스트 삭제. 제품 코드에 새 우회 경로 없음.
  W2 확인 결과: 출력의 빈 `()`는 정상 실행에서는 생기지 않고 출처 문자열이 없는 대역을 넣을 때만 생긴다(질문 시 관찰의 원인).

| ID | 정본 | 위치 | 요지 | 처분 |
|---|---|---|---|---|
| N3 | 2.3, 2.4 | `coding-fallback/picker.test.ts:10-184`, `aaii-router/test-support.ts`, `openrouter-catalog-filter/index.test.ts:30-72` | "모듈을 임시 사본으로 복사하고 옆에 SDK 대역 패키지를 써서 불러오는" 시험 장치가 세 벌. 셋 다 main 이후 바뀐 범위 | **수정** — 장치 하나를 두고 세 시험이 각자 필요한 대역 내용만 넘긴다. 세 사본 삭제(3절 "정당한 경우": 새 책임, 길 하나, 이유 보고) |

- N3 확인: 시험 장치는 `test-support/module-harness.ts` 하나(복사·대역 패키지 쓰기·import·정리만, 30줄). `picker.test.ts`,
  aaii-router `fallback-tui.test.ts`·`index.test.ts`, openrouter `index.test.ts`가 사용. 대역 내용은 각 확장 쪽에 남음
  (aaii-router `test-support.ts`는 대역 내용만). 전체 225 pass / 0 fail / 0 skip(전후 같은 수). 작업자 보고: 공통 import 경로를
  망가뜨리면 네 파일의 시험 50건이 모두 실패.

## 기각 30건 독립 검토 반영 (`_research/standard-review-iron-laws-rejections.md`, opencode)

결과: 동의 22 / 부분 동의 8 / 불동의 0, VERDICT "some rejections must be revisited". 코디네이터가 근거를 읽고 다음과 같이 다시 처분한다.
기각 사유가 사실과 달랐던 두 건(IL-14 "각자 문서화한 어휘" — 두 README 모두 `on`/`off`만 문서화, IL-30 "호출자는 IL-34에서 고친다" —
IL-34는 `loadScores`라 인용이 틀렸고 실제 호출자 IL-29·IL-31도 기각돼 아무 데서도 고쳐지지 않음)은 코디네이터의 판정 오류로 기록한다.

| ID | 이전 처분 | 새 처분 | 근거 |
|---|---|---|---|
| IL-29 | 의도된 계약 | **수정** | `readExisting`이 ENOENT와 읽기 실패를 구분하지 않음. 같은 변경에서 `loadScores`·`loadState`는 ENOENT만 조용히 처리하도록 바뀌었으므로 2.4 일관성 결함. ENOENT 외 오류는 결과 메시지에 경로·이유로 붙인다 |
| IL-31 | 의도된 계약 | **수정** | `loadFreeSnapshot`이 ENOENT·권한·디렉터리·깨진 JSON을 모두 `undefined`로 접음. ENOENT만 `undefined`, 그 밖은 경로·이유를 담아 오류. `config.ts`는 이유를 알리면서 model_list를 그대로 두는 현재 동작 유지 |
| IL-30 | 의도된 계약 | 의도된 계약(근거 정정) | 근거를 "파서 계약(경로를 모르는 파서의 `undefined`)"으로 한정. 호출자 처리는 IL-29·IL-31 |
| IL-06 | 의도된 계약 | 의도된 계약 + **N4 수정** | URL 리터럴 기각은 유지. `quota-providers/catalog.ts`의 `EXCLUDED_MODELS[].host`가 `DASHSCOPE.baseUrl`에서 계산 가능한 값을 다시 적음(2.4) → `parseProviderUrl`로 도출(N1과 같은 방식). `providers.ts` tier 표의 host 키는 분류 데이터라 유지 |
| IL-14 | 기각 | 기각(통합 안 함) + **N5 수정** | 두 확장 사이 의존이나 공용 모듈은 만들지 않는다(2.1, 2.2). 그러나 받는 어휘가 갈리는 것은 2.4 일관성 결함이다. 기존 사용자를 깨지 않도록 aaii-router가 `enable/enabled/disable/disabled`도 받게 맞추고(의미 변경, 2.8), 오류 문구에 받는 단어를 나열하며 두 README에 같은 어휘를 문서화한다 |
| IL-10 | 기각 | **N6 수정** | 설정 쓰기 순서가 설정 창·`set`·`reset`·편집기 저장에서 서로 다르다(상태 줄 갱신, env 우선 경고 유무). 줄 수 분할이 아니라 2.4 중복 제거로, "저장 → 체인 변경 시 epoch → cache 무효화 → 상태 줄 → env 우선 보고"를 한 함수로 두고 네 경로가 부른다 |
| IL-09 | 기각 | 줄 수 기각 유지 + **수정** | 순수 선택 규칙 `chooseTurnCandidate`가 진입 파일에 남아 있다(2.6). 이 브랜치에서 만든 코드라 부채로 미루지 않는다. 쿨다운·선택 규칙을 소유한 모듈로 옮기고 직접 시험 |
| IL-08 | 기각 | 기각(근거 정정) | 파일 줄 수 자체는 위반 근거가 아니다(2.1). 섞여 있던 책임 중 설정 쓰기(N6)와 순수 선택 규칙(IL-09)은 이번에 나간다. 남는 설정 창·편집기 대화 함수는 진입 파일의 상태(cache·epoch·설정 경로)가 필요한 shell 코드라 옮기면 콜백 전달 계층만 생긴다(2.2) |

| 담당 | 항목 | 소유 파일 |
|---|---|---|
| W3 (codex) | IL-29, IL-31, N4 | `coding-fallback/free-fetch.ts`, `free-models.ts`, `config.ts`와 시험·README, `quota-providers/catalog.ts`와 시험 |
| W4 (agy) | N5, N6, IL-09 | `aaii-router/settings.ts`, `index.ts`, `cooldown.ts`(또는 `chain-order.ts`)와 시험·README, `openrouter-catalog-filter/README.md`(어휘 문서만) |

## 담당과 소유 파일 (겹치지 않음)

- **W1 (codex)**: `extensions/coding-fallback/`(`fetch-scores.mjs`, `scores.ts`, `index.ts`, `picker.ts`, `free-models.ts`, `chain.ts`,
  `providers.ts`, `config.ts`와 해당 시험), `extensions/quota-providers/catalog.ts`(+시험), `extensions/aaii-router/`(`candidates.ts`,
  `settings.ts`, `index.ts`와 해당 시험·README)
- **W2 (agy)**: `extensions/openrouter-catalog-filter/`(`index.ts`, `state.ts`와 시험·README)
- 수정 뒤 독립 재리뷰: opencode(새 세션, 구현 비참여)

## W1 mutation check (pi) 반영 (`_research/mutation-check-iron-laws-w1.md`)

사본에서 기준 시험 212 pass를 재현한 뒤 변이 22개: killed 13 / survived 9. 코디네이터가 생존 9건을 다음과 같이 처분한다.

| ID | 생존 변이 | 처분 | 근거 |
|---|---|---|---|
| S1 | aaii-router `currentSettings`가 `readSettingsFile` 오류를 삼켜 기본값으로 대체(M21) | **수정** — 시험 추가 | IL-25의 핵심 계약 "설정 읽기 실패가 라우팅에 드러난다"가 호출자 쪽에서 검증되지 않음(2.9). `index.test.ts`에서 설정 경로를 디렉터리로 두고 라우팅·보고가 이유와 함께 거부되는지 확인 |
| S2·S3 | 기본 경로의 모듈 기준 계산, ExpLabs 주소의 두 소비자 동일성 | 근거 있는 기각 | 구조 계약이다. 값 고정 시험을 더하면 같은 상수를 다시 적는 과검증이 된다(2.9). 단일 출처는 코드 구조(N1, IL-16)로 보장 |
| S4·S5 외 | try/catch·cwd 대체·단언 제거 같은 방어 제거 | 근거 있는 기각 | 지운 코드라 관측 가능한 동작이 없다. 되살아나면 5단계 grep(`catch`, `process.cwd`)이 잡는다 |

## W3 결과 확인 (codex, `_research/w3-iron-laws-report.md`)

- IL-31: `loadFreeSnapshot`은 ENOENT만 `undefined`, 읽기 실패는 `cannot read free snapshot <path>: <reason>`, 파서 거부는
  `invalid free snapshot <path>: …` 오류. `config.ts readInputs`는 그 이유를 `freeReadError` notice로 넘기고 model_list를 그대로 둔다. 확인함.
- IL-29: `free-fetch.ts`의 중복 `readExisting`을 지우고 같은 로더를 쓴다. 읽기 실패는 결과 메시지에 붙는다. 이전 파일은 신선도
  판단과 변경 비교에만 쓰이고 스냅숏은 probe 결과로 새로 만드므로, 깨진 이전 파일을 덮어써도 잃는 데이터가 없다. 확인함.
- N4: `EXCLUDED_MODELS[].host`가 `parseProviderUrl(DASHSCOPE.baseUrl)`에서 계산된다. 확인함.
- 코디네이터 확인: coding-fallback + quota-providers 시험 123 pass / 0 fail / 0 skip. 바뀐 줄에 `await import`·넓은 `catch {}`·
  `process.cwd`·`as unknown as`·skip·`setTimeout`·절대 경로 없음.

| ID | 정본 | 위치 | 요지 | 처분 |
|---|---|---|---|---|
| N7 | 인계 위생(2.11), 주변 코드와 같은 형태 | `quota-providers/catalog.ts:1-2` | W1이 넣은 import가 파일 머리 설명 주석보다 앞에 있다. HEAD에서는 설명 주석이 첫 줄 | **수정** — import를 설명 주석 뒤로 옮긴다 |

S1·N7은 W4가 끝난 뒤 pi에게 맡긴다(`aaii-router/index.test.ts`는 W4 소유라 그 전에는 겹친다).

## W4 결과 확인 (agy, `_research/w4-iron-laws-report.md`)

- N5: `parseToggle`이 `on/true/yes/1/enable/enabled`, `off/false/no/0/disable/disabled`를 받고, 실패 문구에 받는 단어를 모두 나열한다.
  두 README에 같은 어휘. 확인함.
- N6: `commitSettings`(저장 → `routingChanged`면 epoch → `forget` → 상태 줄 → env 우선 경고)를 설정 창·편집기 저장·`set`·`reset`
  네 곳이 부른다. 의미 변경: `set`·`reset`도 이제 상태 줄을 지우고 env 우선 경고를 낸다. 확인함.
- IL-09: `chooseTurnCandidate`가 `cooldown.ts`로 옮겨졌고 논리는 원래 코드와 같다(`cooldowns` 형만 `| undefined`로 넓어짐).
  `cooldown.test.ts`에 직접 시험. 확인함.
- 코디네이터 확인: 전체 `extensions/*/*.test.ts` 232 pass / 0 fail / 0 skip. 바뀐 줄의 grep 결과는 W2의 `catalog.skipped` 필드뿐(덧대기 아님).
- 보고 정정: W4 보고서는 IL-08에 "책임 분리(TUI 분리 등)는 부채로 기록"이라고 적었으나 처분 기록의 IL-08은 근거 정정된 **기각**이고
  부채를 만들지 않았다. 이 기록이 우선한다.

| ID | 정본 | 위치 | 요지 | 처분 |
|---|---|---|---|---|
| N8 | 2.5 YAGNI | `aaii-router/index.ts` `commitSettings`의 `path = globalSettingsPath()` | 네 호출자가 모두 경로를 넘겨 기본값을 쓰는 곳이 없다 | **수정** — 기본값을 지우고 필수 인자로 |

S1·N7·N8을 pi에게 맡긴다(소유 파일: `aaii-router/index.ts`, `aaii-router/index.test.ts`, `quota-providers/catalog.ts`).

## W5 결과 확인 (pi, `_research/w5-report.md`)

- pi가 `engineering-standard` 스킬을 `~/.pi/agent/skills/engineering-standard`(공유 원본 `~/.agents/skills`로의 링크)에서 불러왔다고 보고.
- S1: `index.test.ts`에 설정 경로를 디렉터리로 두고 라우팅(`request`)과 보고(`command("")`)가
  `cannot read settings … settings.json … EISDIR`로 거부되는지 보는 시험. 작업자 mutation: `currentSettings`가 오류를 삼키면 이 시험만 실패. 확인함.
- N7: `catalog.ts` import가 머리 설명 주석 뒤(29–30행). N8: `commitSettings(…, path: string, …)` 필수 인자. 확인함.
- 코디네이터 확인: 전체 233 pass / 0 fail / 0 skip.

## 최종 Iron Laws 대조 (`_research/iron-laws-after-w5.json`)

IL 번호는 처음 보고서의 지적을 (규칙, 파일, 줄) 순으로 정렬한 순번이다. 대조는 `fingerprint`로 한다.

- 처음 50건(D) → 32건(D), `scan_status` complete, 종료코드 1. 사라짐 21 / 남음 29 / 새로 생김 3.
- 수정으로 처분한 24건 중 21건이 사라졌다. 사라진 지적은 모두 수정으로 처분한 것이다(처분 없이 사라진 것 없음).
- 남은 29건 중 26건은 기각·의도된 계약으로 처분한 지적이 그대로 남은 것이다.

수정으로 처분했는데 남은 3건과 새로 생긴 3건:

| ID | 규칙 | 위치 | 처분 | 근거 |
|---|---|---|---|---|
| IL-09 | ARC-201 | `aaii-router/index.ts:482` 진입 함수 193줄 | 기각(줄 수) | 처분한 책임(순수 선택 규칙)은 `cooldown.ts`로 나갔다. 남은 지적은 줄 수뿐이고 2.1에 따라 줄 수만으로 나누지 않는다 |
| IL-10 | ARC-201 | `aaii-router/index.ts:553` 명령 handler 113줄 | 기각(줄 수) | 처분한 중복(설정 쓰기 네 벌)은 `commitSettings`로 없앴다. 남은 것은 하위 명령 분기라 줄 수 기각과 같다 |
| IL-36 | IL-301 | `openrouter-catalog-filter/index.ts:230` `JSON.parse`의 `catch` | 오탐 | 예외를 삼키지 않고 `{ ok: false, reason }`으로 돌려주며, 호출자가 건너뛴 출처와 이유를 보고한다(W2, N2 확인). 도구는 `catch` 블록만 본다 |
| 새 | AI-101 | `coding-fallback/free-models.ts:53` `EXPLABS_BASE_URL` | 의도된 계약 | IL-03·IL-07 수정으로 만든 공개 upstream 주소의 단일 출처다. 옮겨지면서 fingerprint가 바뀌었을 뿐이다(IL-06과 같은 근거) |
| 새 | IL-307 / IL-301 | `coding-fallback/providers.ts:116,120` `parseProviderUrl` | 의도된 계약 | 경로·문맥을 모르는 파서의 `undefined`는 "URL이 아님"이다(IL-30과 같은 파서 계약). 고정 주소의 호출자(`free-models.ts`, `catalog.ts`)는 불러올 때 던지고, 설정 호출자(`settings.ts`)는 거부 이유를 보고한다 |

## 재리뷰 반영 (opencode 새 세션, `_research/standard-rereview-iron-laws.md`)

opencode는 `engineering-standard` 스킬을 `~/.agents/skills/engineering-standard`에서 불러왔다고 보고했다.
결과 VERDICT findings remain, 7건. 코디네이터가 각 위치를 읽어 사실을 확인했다(모두 사실).

| ID | 정본 | 위치 | 확인한 사실 | 처분 | 담당 |
|---|---|---|---|---|---|
| RR-01 | 2.4, 2.7 | `aaii-router/index.ts:195-208` `currentSettings` | 신뢰하지 않는 프로젝트의 파일을 "있으면 무시했다고 알리기" 위해 `readSettingsFile`로 읽는다. IL-25로 이 로더가 ENOENT 외 오류를 던지게 되어, 무시해야 할 파일이 디렉터리·읽기 불가면 라우팅 전체가 거부된다. README의 신뢰 경계 계약과 어긋나는 **IL-25 수정이 만든 회귀** | **수정** | W6 |
| RR-02 | 2.4 | `openrouter-catalog-filter/state.ts:90,116` | 받는 어휘는 `ON`/`OFF` 집합인데 오류 문구는 `expected true or false` / `expected on or off`. N5에서 aaii-router만 맞췄다 | **수정** | W7 |
| RR-03 | 2.5 | `aaii-router/index.ts` `commitSettings(…, infoMessage?)`; `openrouter-catalog-filter/index.ts` `readStoredModels(skipped = [])`, `builtinFallbackModels(skipped = [])` | 모든 호출자가 값을 넘겨 기본값·선택 경로를 쓰는 곳이 없다(N8과 같은 형태) | **수정** | W6(aaii), W7(openrouter) |
| RR-04 | 2.3 | `aaii-router/index.ts:464` `const edited =` | N6 뒤 읽는 곳이 없는 바인딩 | **수정** | W6 |
| RR-05 | 2.9, 3절 | `quota-providers/catalog.test.ts:25-45` | 사본의 제품 소스 문자열을 치환해 import하는 상주 시험. 일회 mutation check를 상주 시험으로 둔 형태이고 소스 표기에 묶인다 | **수정(시험 삭제)** — 이 시험과 그 전용 import 제거. N4는 단일 출처 구조와 W3의 일회 변이 기록으로 확인 | W7 |
| RR-06 | 2.9 | `openrouter-catalog-filter/index.test.ts` | 저장본의 비-ENOENT 읽기 실패 분기(`could not read <path>: …`)를 지나는 시험이 없다 | **수정(시험 보강)** | W7 |
| RR-07 | 2.9 | `aaii-router/settings.test.ts:323-332` | 새 시험이 기존 `parseToggle` 어휘 시험(:58-63)과 `editSetting` 오류 시험(:87-90)을 반복 단정 | **수정(중복 정리)** | W6 |

판정 오류 기록: RR-01은 W1 결과 확인 때 코디네이터가 `currentSettings`의 두 번째 호출(신뢰하지 않는 경로)을 읽지 않아 놓쳤다.
pi의 S1 시험도 신뢰된 전역 경로만 다뤘다.

| 담당 | 항목 | 소유 파일 |
|---|---|---|
| W6 (codex) | RR-01, RR-03(aaii), RR-04, RR-07 | `aaii-router/index.ts`, `index.test.ts`, `settings.ts`, `settings.test.ts`, `README.md` |
| W7 (pi) | RR-02, RR-03(openrouter), RR-05, RR-06 | `openrouter-catalog-filter/state.ts`, `state.test.ts`, `index.ts`, `index.test.ts`, `README.md`, `quota-providers/catalog.test.ts` |

## W6·W7 결과 확인

- W6 (codex, `_research/w6-report.md`): RR-01 `currentSettings`는 신뢰하지 않는 프로젝트 파일을 읽지 않고 `lstat`으로 존재만 확인해
  `ignored … not trusted` note를 남긴다(ENOENT 외 실패는 이유를 note에 붙이고 라우팅 계속). RR-03 `commitSettings(…, infoMessage: string)`,
  RR-04 `ui.custom` 결과 바인딩 제거, RR-07 중복 단정 정리. 작업자 mutation: 신뢰하지 않는 경로에 읽기 로더를 되돌리면 2건 실패. 확인함.
- W7 (pi, `_research/w7-report.md`): RR-02 `state.ts`가 `SWITCH_WORDS`(ON/OFF 집합)로 안내, 파일 값은 JSON 불리언도 명시.
  RR-03 `readStoredModels`·`builtinFallbackModels`의 `skipped` 필수, `applyAllowlist` 기본값은 생략 호출자가 있어 유지.
  RR-05 소스 치환 시험과 전용 import 제거. RR-06 `models-store.json` 디렉터리 시험(`store skipped: could not read …models-store.json: EISDIR`). 확인함.
- 코디네이터 확인: 전체 234 pass / 0 fail / 0 skip. 바뀐 줄·추적되지 않은 시험에 덧대기 grep 결과 없음.
- Iron Laws(`_research/iron-laws-after-w7.json`): 32건, complete. `iron-laws-after-w5.json`과 fingerprint가 모두 같다(사라짐 0 / 새로 생김 0).

## 최종 독립 확인 반영 (opencode 새 세션, `_research/standard-final-check-iron-laws.md`)

RR-01~07 모두 해결로 판정. 234 pass / 0 fail / 0 skip. 새 지적 1건:

| ID | 정본 | 위치 | 요지 | 처분 |
|---|---|---|---|---|
| FC-01 | 2.11 | `openrouter-catalog-filter/index.test.ts:9-11,299-302`, `state.test.ts:53-54` | 시험 주석에 리뷰 ID(`RR-06`)와 예전 문구 비교 | **수정(코디네이터)** — 같은 형태의 `IL-36/37`·`IL-50`(`index.test.ts` 머리 주석)·`IL-39`(`state.test.ts`)도 함께 지웠다. 현재 동작 설명만 남김 |

확인: `extensions/`·`test-support/`에 처분 ID 문자열 없음(grep). 주석만 바뀌어 전체 234 pass / 0 fail / 0 skip 그대로.
코드 동작을 바꾸지 않은 정정이라 독립 확인을 다시 받지 않는다(SKILL 7단계).

## 완료 정의 (정본 2.10)

| 단계 | 판정 | 증거 |
|---|---|---|
| 1. 소스·import·빌드 | 충족 | `node --test`(type stripping)가 모든 확장 모듈과 시험을 불러온다. 저장소에 tsc가 없어 형 검사는 따로 돌지 않는다 |
| 2. 대역 통합 | 충족 | `extensions/*/*.test.ts` 234 pass / 0 fail / 0 skip. 대역은 SDK 패키지·파일 I/O·HTTP 경계에만(`test-support/module-harness.ts`) |
| 3. 사용 가능한 실물 증거 | **미충족** | 이번 수정 뒤 실제 Pi 세션에서 라우팅·명령을 돌려 본 기록이 없다 |
| 4. 실물 준비 완료 | **미충족** | 3단계가 없다. 변경은 아직 커밋되지 않았다 |

- Iron Laws: 50 → 32건(complete). 남은 32건은 모두 기각·의도된 계약·오탐으로 처분됨. 수정 처분 중 남은 지적 없음(IL-09·IL-10은 줄 수만 남아 기각, IL-36은 오탐).
- 남은 일: 실물 증거(3·4단계), GPT Pro 리뷰(사용자가 기존 대화로 받음), 커밋.
