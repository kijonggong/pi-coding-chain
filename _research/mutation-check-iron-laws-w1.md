# 독립 mutation check — Iron Laws 수정(W1 담당) 항목 (2.9)

- 대상: 커밋 `3bab77c` 위의 작업나무(미커밋 변경). 표기 "IL-NN"·"C-N"은 `_research/standard-disposition-iron-laws.md`의 수정 처분표.
- 방법: 저장소 전체(.git 제외)를 OS 임시 폴더로 복사 후 기준 시험 재현 → 항목별로 고친 규칙을 한 줄로 되돌리는 변이를 적용 → 지정 3개 디렉터리 전체 시험 실행 → 원복. 본 검토는 구현(W1)과 별도 세션에서 수행했다.
- 기준 재현: `PI_OFFLINE=1 PI_CODING_FALLBACK_FREE_REFRESH=off node --test extensions/aaii-router/*.test.ts extensions/coding-fallback/*.test.ts extensions/quota-providers/*.test.ts` → **212 pass / 0 fail** (복사본에서 동일).
- 주의(재현성): 검토 중 작업나무가 계속 움직였다. 1차 복사본(10:53)에서는 `free-models.ts`의 `host: explabsUrl.hostname` 도출이 아직 반영 전(`host:` 리터럴)이었고, 시험 하네스가 `test-support/module-harness.ts`로 일반화되는 중이었다. 아래 결과는 **최신 스냅샷을 다시 복사**해 전량 재실행한 값이다(212 pass 기준 확인 후 변이 22건 적용). 변이 적용·원복은 파일 단위 pristine 사본 대조로 검증했다.
- 작업나무는 전혀 수정하지 않았다(이 문서만 작성). 임시 복사본은 검증 후 삭제.

## 1. 변이 결과표

변이는 "고친 규칙을 한 줄 되돌리기"다. 기대: 각 변이마다 관련 시험이 최소 1개 실패(killed). 살아남음(survived)은 그 계약을 잡는 시험이 없다는 뜻.

| ID | 규칙 | 변이 (before → after) | 실패한 시험 | 결과 |
|---|---|---|---|---|
| M01 | IL-34 `scores.ts loadScores` | 깨진 스냅샷에서 오류 발사 → `return parseScores(text) ?? EMPTY` (빈 표로 조용히 대체) | loadScores only treats ENOENT… / registry and routing reject corrupt… / check and sync refuse corrupt… / add score lookup propagates corrupt… (4) | killed |
| M02 | IL-34 `scores.ts loadScores` | 비-ENOENT 읽기 오류의 경로·이유 포함 throw → `return EMPTY` 한 줄 | registry and routing reject corrupt… / check and sync refuse corrupt… / loadScores only treats ENOENT… (3) | killed |
| M03 | IL-34 호출자 `config.ts readInputs` | loadScores 오류의 `{error}` 변환 try/catch 제거(원본 예외가 그대로 샘) | check and sync refuse corrupt or unreadable scores without backup or write | killed |
| M04 | IL-28+35 `fetch-scores.mjs` | 별칭 보존 실패 시 중단 → `catch { aliases = {} }` 후 계속 쓰기 | refresh refuses corrupt or unreadable previous scores… | killed |
| M05 | IL-28+35 `fetch-scores.mjs` | 기존 파일 읽기의 ENOENT 외 오류 재던짐 → 조용히 무시 | refresh refuses corrupt or unreadable previous scores… | killed |
| M06 | IL-27 `fetch-scores.mjs` | `skipping index record …` 출력 → `.catch(() => null)` (조용한 건너뜀) | refresh accepts missing scores, preserves aliases, and reports each skipped record | killed |
| M07 | IL-32 `coding-fallback/index.ts extensionDir` | 직접 `dirname(fileURLToPath(…))` → `try/catch` + `process.cwd()` 대체 복원 | (없음) | **survived** |
| M08 | IL-16+C-3 `aaii-router/index.ts` | coding-fallback의 `resolveScoresPath` import → aaii-router가 `"..", "coding-fallback", "aaii-scores.json"` 경로를 스스로 계산 | (없음) | **survived** |
| M09 | IL-03+07+C-1 `quota-providers/catalog.ts` | `EXPLABS_BASE_URL` import → 주소 리터럴 재삽입 | (없음) | **survived** |
| M10 | IL-03+07+C-1 `free-models.ts` | `parseProviderUrl(EXPLABS_BASE_URL).hostname` 도출 → `host:` 리터럴 재삽입 (도출 guard `throw` 포함 삭제) | (없음) | **survived** |
| M11 | IL-19+20+23+26+C-2 `settings.ts originOf` | http(s)만 허용 → 어느 프로토콜이든 origin 수용 | normalizes an origin and refuses what is not one / validates one setting at a time… (2) | killed |
| M12 | C-2 `candidates.ts` 제외 비교 | origin(프로토콜+host+포트) 비교 → hostname만 비교 (포트가 다르면 제외가 안 걸림) | excludes models served through the LiteLLM proxy / settings origins match normalized candidate sources including ports… / set origins redirects… / settings window Excluded origins… (4) | killed |
| M13 | C-2 `chain.ts readModelEntries` | `hostname` 추출 → origin에서 프로토콜만 뗀 문자열(포트 부착) | chain host classification normalizes URL hosts… / a zero price reorders within its tie… (2) | killed |
| M14 | IL-21+22 `publishStatus` | 직접 호출 → 예외 불가능한 `setStatus`를 다시 try/catch로 포장 | (없음) | **survived** |
| M15 | IL-21+22 상태줄 계약 | `` `${PROVIDER} → ${label}` `` → label만 전달 | session start clears status and routing publishes the chosen model through the SDK UI | killed |
| M16 | IL-25 `settings.ts readSettingsFile` | 비-ENOENT 오류 throw → `.catch(() => undefined)` (조용한 기본값) | settings read and load surface non-ENOENT errors with path and reason | killed |
| M17 | IL-49 `picker.ts confirm` | `get` 후 undefined 검사 → `has` + `get(id)!` 단언 복원 | (없음) | **survived** |
| M18 | IL-16+C-3 `coding-fallback/index.ts` | `resolveScoresPath` import → 자체 경로 계산 복원 | (없음) | **survived** |
| M19 | IL-34 호출자 `coding-fallback scoreOf` | 점수 조회가 loadScores 오류를 그대로 전파 → `catch { return undefined }` | add score lookup propagates corrupt scores and uses the module-relative default | killed |
| M20 | IL-21+22 `session_start` 핸들러 | 직접 `ctx.ui.setStatus` → `ctx?.ui?.setStatus?.` 옵셔널 체인 복원 | (없음) | **survived** |
| M21 | IL-25 호출자 `aaii-router currentSettings` | loadSettings 오류 전파 → `catch { DEFAULT_SETTINGS }` 조용한 대체 | (없음) | **survived** |
| M22 | IL-34 호출자 `config.ts readInputs` | loadScores 오류 → 빈 점수표로 계속 진행(수정 전의 조용한 동작) | check and sync refuse corrupt or unreadable scores without backup or write | killed |

집계: **killed 13 / survived 9** (변이 총 22건).

## 2. 생존자(survivor) 목록과 판정

생존은 "그 계약을 잡는 시험이 없다"(2.9: 누락된 계약)를 뜻한다. 다만 내용별로 심각도가 다르다.

**S1. M21 — aaii-router가 설정 읽기 오류를 삼키면 아무 시험이 못 잡는다. 실제 결함 경계다.**
IL-25로 `readSettingsFile`은 비-ENOENT 오류를 던지게 바뀌었고 `settings.test.ts`가 그 함수를 직접 검증한다. 그러나 **소비자인 `currentSettings`가 그 오류를 삼키면**(예: `catch { DEFAULT_SETTINGS }`) 아무 시험이 실패하지 않는다. 즉 "설정 읽기 실패가 라우팅에 드러난다"는 이 수정의 핵심 계약이 호출자 쪽에서는 검증되지 않았다. `index.test.ts` harness가 `PI_AAII_ROUTER_SETTINGS`를 항상 임시 파일로 지정하기 때문에, 진입 파일 시험이 실제 읽기 오류 경로(예: 설정 경로를 디렉터리로 지정)를 한 번 통과시키면 잡힌다. 이것이 9건 중 유일하게 "채워야 할 계약" 후보다.

**S2. M07/M08/M18 — 경로 소유권(IL-16+C-3, IL-32)의 재중앙화 자체는 시험이 못 잡는다.**
- M08: aaii-router가 남의 디렉터리 구조(`"..", "coding-fallback"`)를 다시 알아도 시험이 실패하지 않는다. `index.test.ts`의 "router uses the score owner's module-relative default outside the working directory"는 경로 협력을 검증하지만, 두 모듈이 서로 다른 경로를 계산해도 **환경변수 무시·모듈 상대 기본값이라는 관측 가능 동작이 우연히 같아** 살아남는다.
- M18: coding-fallback이 자체 경로 계산을 되살려도 마찬가지다.
- M07: `extensionDir`의 try/catch+cwd 복원은 관측 가능한 동작 변화가 없어(도달 불가 경로) 원래부터 죽일 시험이 없다 — 이는 2.9 관점에서 결함이 아니라, IL-32가 죽은 방어 코드 제거였다는 처분의 정당성을 반대로 확인해 준다.
- 판정: 소유권 규칙(한 곳이 경로를 안다)은 "같은 지식 두 곳 기입 금지"라 정적 구조 계약이라 시험으로 죽이기 어렵다. 다만 M08은 발견 가능성이 0이 아니다 — `resolveScoresPath`가 `join(extensionDir(aaii-router), "..", "coding-fallback", …)`를 계산할 때 `dirname`을 aaii-router 위치 기준으로 잡으면 모듈 상대 기본값이 달라지므로, 변이가 실제 디렉터리 관계를 어기는 방향이면 기존 시험이 잡는다. 잡히지 않은 이유는 변이가 우연히 동치인 경로를 만들었기 때문이다. **요구사항은 아니다**; 원하면 `resolveScoresPath`와 aaii-router 기본값의 동일성을 독립 기대값으로 비교하는 한 줄 시험으로 닫을 수 있다.

**S3. M09/M10 — ExpLabs 주소 단일 출처(IL-03+07+C-1)가 시험으로 못 박히지 않았다.**
두 모듈이 같은 리터럴을 다시 각자 들어도 시험이 실패하지 않는다. 단일 출처(SSOT) 규칙은 "두 사본이 어긋날 때" 피해가 드러나는데, 어긋남을 만드는 변이(한쪽만 다른 주소로)까지는 시험하지 않았다. 판정: M09는 `catalog.test.ts`의 "native ExpLabs registration targets the published v1 endpoint"가 리터럴 기대값을 독립적으로 박아두고 있어 **주소 값 자체의 검출력은 있다**. 남는 공백은 "두 소비자가 항상 같은 주소를 본다"는 관계인데, 이는 S2와 같은 구조 계약이다. 우선순위 낮음.

**S4. M14/M20 — try/catch·`?.` 제거(IL-21+22)는 원래부터 시험 검출력이 없다.**
`setStatus`는 SDK 계약상 예외를 던지지 않으므로(처분 기록이 직접 확인한 사실), 그 방어를 다시 두어도 관측 가능한 동작이 없다. killed/silled의 프레임에서 보면 이 항목의 mutation check는 불가능하며, 죽일 수 없음이 곧 "죽은 방어 코드"라는 W1 처분의 정당성 증거다. M15(상태줄 텍스트 계약)는 killed이므로 상태 표시 기능 자체는 검증되어 있다.

**S5. M17 — `picker.ts`의 `has`+`get(id)!` 되살리기가 안 잡힌다.**
IL-49는 타입-단언 제거(TYP-301)지 동작 변경이 없어서, 관측 가능한 실패를 만들 수 없는 변이였다. 실제 결함(후보 목록에 없는 id가 `resolveSelection`을 통과)은 도달 불가능 경로(`resolveSelection`의 order/마킹 원본이 항상 byId의 키 집합과 일치)라 2.7의 도달 불가 상태와 같다. 시험으로 죽일 방법이 없어 결함은 아니다.

요약하면: **진짜 채워야 할 계약은 S1(aaii-router 설정 읽기 오류의 호출자 전파) 하나**이고, S2·S3은 구조 계약이라 시험 부재를 반드시 결함으로 단정할 수 없으며, S4·S5는 애초에 관측 가능한 동작이 없는 항목이다.

## 3. 과검증(over-specification)·우회 검토 (2.9)

W1이 새로 추가한 시험 중 과검증 후보를 검토했다. 결론부터: **치명적인 과검증은 없다.** 대상별 판정:

**통과 (독립 기대값, 실제 경로):**
- `fetch-scores.test.ts` (IL-27/28/35): 외부 경계(`fetch`)만 스텁으로 대체하고 실제 CLI를 `spawnSync`로 돌려 파일을 읽고 쓴다. 기대값(`"cannot preserve aliases"`, `EISDIR`, 별칭 보존)은 리터럴이다. M04/M05/M06이 정확히 이 시험들에 걸렸다. 모범적 계약 시험.
- `scores.test.ts`의 `loadScores` 시험 (IL-34): 실제 파일시스템(`mkdtemp`)으로 ENOENT/깨진 JSON/디렉터리를 구분하고 오류 문구의 경로 포함까지 확인한다. M01/M02가 여기 걸렸다.
- `config.test.ts` "check and sync refuse corrupt…" (IL-34): 실패 시 **백업도 쓰지 않고 원본이 그대로인지**까지 확인 — 오류 전파와 무부작용을 같이 검증한다.
- `index.test.ts`(aaii-router) "registry and routing reject corrupt…" — 진짜 진입 파일을 임시 디렉터리에 복사해 임포트하고 오염된 점수 파일로 routing·report가 거부되는지 본다. M01/M02/M03/M19가 이 경로들에서 걸렸다.
- `settings.test.ts` "settings read and load surface non-ENOENT…" (IL-25): 실제 디렉터리(EISDIR)로 검증, M16이 여기 걸림.
- `candidates.test.ts` 신규 시험 (C-2): `HTTPS://API.EXAMPLE:8443` → `https://api.example:8443` 정규화와 포트 차이 제외를 독립 기대값으로. M11/M12가 여기 걸림.
- `chain.test.ts` 신규 시험 (C-2): 대문자 URL의 host 소문자 정규화 + 깨진 URL 미분류. M13이 여기 걸림.

**후보 (경계선, 권고 수준):**
1. **"free probe targets the published ExpLabs v1 endpoint"** (`free-models.test.ts`) — `FREE_PROBE_TARGETS[0].baseUrl === "https://api.experientiallabs.ai/v1"`는 제품 상수와 같은 문자열을 시험 쪽에 다시 적은 것이다. 다만 이것은 "값의 복사"가 아니라 **외부 서비스의 고정 엔드포인트라는 독립 사실**을 고정하는 것이라 2.9의 "기대값이 구현에서 복사되지 않았는지" 기준에서는 양성에 가깝다 (주소가 바뀌면 시험이 알려주는 것이 목적). 유지해도 되고, 걸어두면 `EXPLABS_BASE_URL` 상수 자체가 같은 파일에 있으므로 SSOT 검출력(어긋남 탐지)은 없음을 인지할 것 — S3과 같은 공백이다.
2. **"native ExpLabs registration targets the published v1 endpoint"** (`quota-providers/catalog.test.ts`) — 같은 형태. `EXPLABS.baseUrl` 리터럴 단정은 `EXPLABS_BASE_URL` import 도입 후 "import가 리터럴로 되돌아가도" 잡지 못한다(M09 생존의 원인). 구조 계약을 시험으로 못 박으려는 것이 아니라면 그대로 두어도 된다.
3. **`picker.test.ts`의 모듈 하네스** — `MODULES` 목록에 `index.ts`, `config.ts`, `listing.ts`, `free-fetch.ts`가 추가되고 `getAgentDir` 스텁이 "unused-sdk-agent-directory"를 반환한다. `add` 명령의 점수 전파 시험(M19가 걸린)을 위해 실제 진입 파일을 돌리는 것은 타당하나, 스텁 `getAgentDir`이 "unused"라는 이름으로 설정 파일 경로 책임을 흘리는 모양새다. 실제 경로 우회(2.9)는 아니다 — 시험 대상 경로(환경변수로 지정한 설정·점수 파일)는 실제 파일시스템을 통과한다. 참고: 이 하네스는 이 검토 중 `test-support/module-harness.ts`로 일반화되는 리팩터링이 진행됐고, 그 방향(하나의 시험 인프라)이 2.3/2.4에 부합한다.
4. **`index.test.ts`(aaii-router)의 `statuses` 배열 깊은비교** — `assert.deepEqual(h.statuses, [undefined, "aaii → one/a"])`는 시험 더블이 수집한 호출 순서를 통째로 비교한다. 호출 횟수·순서 고정에 가까워 2.9가 경계하는 형태지만, 상태줄은 "세션 시작 시 클리어 → 라우팅 시 게시"라는 순서가 계약의 핵심이고 다른 관측 수단이 없으므로 마지막 상태만 확인하는 것보다 검출력이 좋다. 변이 M15가 정확히 여기 걸렸으므로 실제로 규칙을 잡고 있다. 유지 권장.
5. **경계선 하나 — 시험명과 실제 검증 범위의 일치**: `index.test.ts`의 "registry and routing reject corrupt or unreadable score files before choosing a model"은 이름과 달리 `report` 전체 명령(`""` 인자)도 검증한다. 문제는 되지 않는다(같은 오류 전파 경로).

**대역 우회 검토:** 스텁은 두 종류뿐 — (a) 외부 네트워크 경계(`globalThis.fetch`), (b) Pi SDK UI/TUI 경계(`ctx.ui`, `pi-tui` 컴포넌트). 둘 다 실제 시스템 경계이며, 시험 더블이 결함을 대신 처리하지 않는다(스텁 `ui.setStatus`는 기록만 한다). "시험의 요청·대역 응답만으로 무송신을 주장"하는 패턴(2.9 마지막 항)도 없다: `config.test.ts`는 실제 파일 무결성까지 확인하고, `fetch-scores.test.ts`는 실제 exit 코드와 파일 내용을 본다.

## 4. 기타 관찰

- 시험 추가와 함께 두 README(aaii-router, coding-fallback)와 quota-providers README에 계약 변화(ENOENT만 조용, 그 외 오류 전파)가 문서화되어 있다. 처분표의 요구를 충족한다.
- M15에서 접두 `aaii → ` 를 제거하는 변이까지 잡히는 것은 상태줄 전체 텍스트를 독립 기대값으로 두었다는 뜻이다.
- 1차 실행(스냅샷 v1)과 2차 실행(스냅샷 v2)의 killed/survived 목록은 일치했다(W1이 검토 중 하네스를 리팩터링했음에도 검출력이 유지됨). 안정성의 방증.

## 5. 결론

- 22건 변이 중 13건 killed. 수정 10건 항목 중 시험이 실제로 규칙을 잡고 있는 것: IL-28+35, IL-27, IL-34(함수+호출자 3곳), IL-19+20+23+26+C-2(정규화 3면), IL-25(함수), IL-21+22(상태줄 텍스트).
- 생존 9건 중 **실제 결함은 S1(aaii-router `currentSettings`의 오류 삼킴) 1건**이고 나머지는 구조 계약(경로·주소 소유권) 또는 관측 불가능한 방어 제거라 시험 부재가 곧 누락은 아니다.
- 권고: S1에 한해 `index.test.ts`에서 설정 경로를 디렉터리로 만들어 routing·report가 거부되는지 확인하는 시험 1개를 추가할 가치가 있다. S2/S3는 선택이며, 원한다면 각각 "모듈 상대 기본 경로 동일성"·"두 소비자 주소 동일성" 한 줄 시험으로 닫는다.
- 과검증: 차단할 것 없음. 후보 2건(ExpLabs 엔드포인트 리터럴 단정 2곳)은 값을 고정하는 의도가 있어 양성이며, 나머지는 계약의 핵심을 독립 기대값으로 검증하고 있다.
