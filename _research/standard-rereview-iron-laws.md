engineering-standard 스킬을 `~/.agents/skills/engineering-standard`에서 불러왔고, 같은 경로의 `references/standard.md`와 저장소 `docs/engineering-standard.md`를 각각 전부 읽었다.

# Iron Laws 수정 재리뷰

## 범위와 확인

독립 리뷰어로서 추적 파일의 미커밋 `git diff` 전체를 읽고, 추적되지 않은 시험 4개(`fetch-scores.test.ts`, `free-fetch.test.ts`, `providers.test.ts`, openrouter `index.test.ts`)와 `test-support/module-harness.ts`를 통째로 읽었다. `_research/standard-disposition-iron-laws.md`도 전부 읽고, 처분 근거를 현재 코드와 호출자에 대조했다.

로더 오류 구분, 점수 경로·URL 정규화의 단일 출처화, 설정 저장 순서 통합, 선택 규칙 이동, 모듈 하네스 통합 등 **수정** 처분의 주된 구현은 확인됐다. 줄 수만 이유로 한 ARC-201 기각, 경로를 모르는 파서의 `undefined`, 고정 공개 엔드포인트 등의 기각도 대체로 타당하다. 다만 아래와 같이 수정으로 생긴 계약 회귀, 미완료 처분, 불필요한 선택 경로 및 시험 문제가 남았다.

허용된 명령 `$env:PI_OFFLINE='1'; $env:PI_CODING_FALLBACK_FREE_REFRESH='off'; node --test extensions/*/*.test.ts`를 실행해 **233 pass / 0 fail / 0 skip**을 확인했다. 이 통과가 아래 계약·구조 지적을 해소하지는 않는다.

## 지적 및 권하는 처분

| ID | 정본 절 | 위치(파일:줄) | 요지 | 권하는 처분 |
|---|---|---|---|---|
| RR-01 | 2.1, 2.4, 2.7 | `extensions/aaii-router/index.ts:195-204`; `extensions/aaii-router/settings.ts:479-485`; `extensions/aaii-router/README.md:173-181` | IL-25에서 `readSettingsFile`이 ENOENT 외 오류를 던지게 됐지만, `currentSettings`는 **신뢰하지 않는 프로젝트의 파일도 같은 로더로 읽는다**. 따라서 무시돼야 할 untrusted `.pi/aaii-router.json`이 디렉터리이거나 읽을 수 없으면 EISDIR/EACCES가 라우팅 거부로 승격된다. README의 “프로젝트 파일은 신뢰할 때만 읽고, 신뢰하지 않으면 무시한다”는 공개 계약과도 어긋나며, 체크아웃된 저장소가 라우터 가용성을 깰 수 있다. | **수정** — global·trusted project 읽기 오류는 계속 전파하되, ignored untrusted file에는 throwing 설정 로더를 쓰지 않는다. 존재 확인과 설정 읽기를 분리하거나 무시 대상의 읽기 실패를 ignored note로 처리하고, untrusted project의 EISDIR/EACCES에서도 global/default로 라우팅되는 통합 시험을 추가한다. |
| RR-02 | 2.4 | `extensions/openrouter-catalog-filter/state.ts:88-90,111-116`; 비교: `extensions/aaii-router/settings.ts:164-166,230-232` | N5는 두 확장의 수용 어휘와 README를 맞췄지만 openrouter의 오류 문구는 여전히 파일 값에는 `expected true or false`, 환경 값에는 `expected on or off`라고만 한다. 실제로는 문자열 `yes/1/enable/enabled` 등도 받으므로 안내가 계약과 다르고, N5에서 전체 어휘를 나열하도록 고친 aaii-router와 같은 종류의 오류 처리가 다시 갈라진다. 기존 시험(`state.test.ts:53,69-73`)은 옛 문구를 그대로 고정하고 있다. | **수정** — 공용 모듈을 새로 만들지 말고 openrouter 모듈 안에서도 ON/OFF 집합으로 안내 문구를 도출한다. 파일 불리언 형식과 문자열 토글을 구분한 정확한 문구로 두 호출자를 맞추고 기대 시험을 갱신한다. |
| RR-03 | 2.5, 3절(분기·설정) | `extensions/aaii-router/index.ts:375-392`; `extensions/openrouter-catalog-filter/index.ts:209-211,245-247` | `commitSettings`의 `infoMessage?`는 네 호출자가 모두 값을 주는데 선택 인자와 `if` 경로로 남았고, `readStoredModels`·`builtinFallbackModels`의 `skipped = []`도 각각 유일한 호출자가 항상 인자를 주므로 사용되지 않는 기본 경로다. N8에서 제거한 `path = globalSettingsPath()`와 같은 “호출자가 없는 기본값/선택 사양”이 이번 수정에서 다시 추가됐다. | **수정** — `infoMessage`와 두 `skipped`를 필수 인자로 하고, 쓰이지 않는 조건·기본값을 지운다. `applyAllowlist`의 기본값처럼 실제 생략 호출자가 있는 경우는 유지한다. |
| RR-04 | 2.3 | `extensions/aaii-router/index.ts:464-480` | N6가 저장 후 처리를 `onSave` 안의 `commitSettings`로 옮기면서 반환값 소비를 지웠지만, `const edited = await ctx.ui.custom(...)`의 변수 `edited`가 남았다. 현재 파일에서 이 바인딩을 읽는 곳이 없는, 교체 후 제거되지 않은 코드다. | **수정** — await은 유지하고 `const edited =` 바인딩만 제거한다. |
| RR-05 | 2.9, 3절(시험) | `extensions/quota-providers/catalog.test.ts:25-45` | N4 시험이 임시 사본의 **제품 소스 문자열을 치환해** 주소를 바꾼 뒤 import한다. 정확한 리터럴 따옴표·배치에 묶인 implementation-coupled test이며, 일회 mutation check를 상주 시험으로 만든 형태다. 동치 리팩터링(상수 추출, 표기 변경)도 공개 계약이 그대로인데 실패시킬 수 있고, 기대 host를 제품의 현재 baseUrl에서 도출하는 다른 시험으로 바꾸면 독립 기대값 원칙도 어긋난다. | **수정(시험 삭제)** — 상주 소스-재작성 시험과 그 전용 import/harness 사용을 제거한다. N4의 host 도출은 코드의 단일 출처 구조와 이미 기록된 일회 변이 검사로 확인하고, 구현에서 파생한 기대값을 다시 쓰는 시험으로 대체하지 않는다. |
| RR-06 | 2.9 | `extensions/openrouter-catalog-filter/index.ts:217-225`; `extensions/openrouter-catalog-filter/index.test.ts:201-294` | IL-36/37의 새 저장본 오류 분기 중 **비-ENOENT 읽기 실패**를 통과하는 시험이 없다. 시험은 ENOENT, 깨진 JSON, 허용 모델 없음만 다루므로, EACCES/EISDIR을 ENOENT와 같은 `the file was missing`으로 접거나 경로·이유를 지우는 변이가 그대로 살아남는다. 코드와 README가 약속한 핵심 실패 가시성 계약이 아직 계약 시험으로 닫히지 않았다. | **수정(시험 보강)** — `models-store.json`을 디렉터리로 둔 오프라인 시험에서 builtin 대체와 함께 `store skipped: could not read <path> … EISDIR`가 보고되는지 확인한다. 기존 ENOENT 시험과 독립 기대값을 유지한다. |
| RR-07 | 2.9 | `extensions/aaii-router/settings.test.ts:58-63,78-90,323-332` | 새 `editSetting accepts expanded…` 시험이 기존 `parseToggle` 어휘 시험과 기존 `editSetting` 오류 시험을 다시 수행한다. 특히 `:328-331`은 `:87-90`과 입력 단어만 다를 뿐 같은 오류 분기·동일한 전체 문구를 반복 단정해, N5에서 늘린 문구 변경 비용을 두 곳으로 만들 뿐 검출력을 더하지 않는다. | **수정(중복 시험 정리)** — 반복된 실패 단정을 삭제한다. `editSetting`의 vision/status 매핑처럼 실제로 추가된 관측이 필요하면 기존 `validates one setting…` 시험에 최소 단정으로 통합하고, 파서 어휘는 기존 한 곳에서만 검증한다. |

VERDICT: findings remain
