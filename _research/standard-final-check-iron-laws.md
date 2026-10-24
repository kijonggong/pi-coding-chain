# RR-01~07 수정 최종 독립 확인

`engineering-standard` 스킬을 불러왔고, 스킬의 `references/standard.md`와 저장소 `docs/engineering-standard.md`를 각각 전부 읽었다. 지난 재리뷰와 처분표의 `재리뷰 반영`·`W6·W7 결과 확인` 절을 대조한 뒤, 이번 라운드에서 RR-01~07을 고친 변경만 읽기 전용으로 확인했다. 작업 트리에는 이전 라운드의 미커밋 변경도 섞여 있으므로 그 밖의 기존 지적은 이번 판정에 포함하지 않았다.

지정 명령 `$env:PI_OFFLINE='1'; $env:PI_CODING_FALLBACK_FREE_REFRESH='off'; node --test extensions/*/*.test.ts`를 직접 실행해 **234 pass / 0 fail / 0 skip / 0 cancelled**를 확인했다. 추적되지 않은 `extensions/openrouter-catalog-filter/index.test.ts`는 통째로 읽었다.

## RR별 해결 여부

| ID | 판정 | 코드로 확인한 근거 |
|---|---|---|
| RR-01 | **해결** | `extensions/aaii-router/index.ts:195-217`은 신뢰하지 않는 프로젝트를 `loadSettings`에 넘기지 않고 `lstat`으로 존재만 확인한다. 디렉터리를 포함해 존재하면 ignored note를 남기고, ENOENT 외 존재 확인 실패도 이유를 note에 남긴 채 라우팅을 계속한다. 읽어야 하는 global·trusted project는 여전히 `settings.ts:479-502`의 throwing 로더를 사용한다. `index.test.ts:224-250`이 실제 디렉터리의 전역 pin 라우팅과 파일 I/O 경계의 EACCES 주입 시 기본 라우팅·원인 보고를 각각 확인하며, `index.test.ts:215-222`는 읽어야 하는 전역 파일의 EISDIR 거부를 유지한다. 문서도 `README.md:173-185`에서 같은 계약을 설명한다. |
| RR-02 | **해결** | `extensions/openrouter-catalog-filter/state.ts:37-49`의 ON/OFF 집합에서 `SWITCH_WORDS`를 도출하고, 파일 값은 JSON 불리언까지 명시한 문구(`:89-96`), 환경 값은 같은 어휘로 만든 문구(`:115-124`)를 사용한다. `state.test.ts:44-59,61-80`이 두 문구를 제품 상수가 아닌 독립 리터럴로 고정한다. |
| RR-03 | **해결** | `extensions/aaii-router/index.ts:384-400`의 `infoMessage`는 필수 문자열이며 옛 조건 분기가 없고, 네 호출자가 모두 메시지를 전달한다(`:436,479,607-613,629`). `extensions/openrouter-catalog-filter/index.ts:209-249`의 두 `skipped`도 필수 인자이며 유일 호출 경로가 인자를 넘긴다(`:270-276`). 실제 생략 호출자가 있는 `applyAllowlist`의 기본값만 남았다(`:162-167,201-203`). |
| RR-04 | **해결** | `extensions/aaii-router/index.ts:471-486`은 `await ctx.ui.custom(...)`을 유지하면서 읽지 않는 `edited` 바인딩을 제거했다. |
| RR-05 | **해결** | `extensions/quota-providers/catalog.test.ts:12-16`에는 소스 치환 시험 전용 파일·경로·하네스 import가 없고, 파일 전체(`:22-133`)에 제품 소스를 사본에 치환해 import하는 상주 시험이 남아 있지 않다. 구현에서 도출한 기대값으로 바꾼 대체 시험도 추가되지 않았다. |
| RR-06 | **해결** | `extensions/openrouter-catalog-filter/index.test.ts:303-331`은 `models-store.json`을 실제 디렉터리로 만들고 builtin 카탈로그 사용(2/4 모델)과 경로·`EISDIR`을 포함한 `store skipped: could not read …` 보고를 확인한다. 기존 ENOENT의 독립 기대값은 `index.test.ts:204-239`에 유지됐고, 제품 분기는 `index.ts:217-225`, 문서는 `README.md:62-65`에서 같은 구분을 보존한다. |
| RR-07 | **해결** | 토글 어휘는 `extensions/aaii-router/settings.test.ts:58-63`, 오류 문구는 `:78-90`의 한 곳에만 남았다. 별도 `editSetting accepts expanded…` 시험은 삭제됐고, 실제 편집 매핑인 vision/status만 기존 개별 설정 시험의 최소 단정으로 통합됐다(`:100-103`). |

## 새 지적

| ID | 정본 절 | 위치 | 요지 | 권하는 처분 |
|---|---|---|---|---|
| FC-01 | 2.11 | `extensions/openrouter-catalog-filter/index.test.ts:9-11,299-302`; `extensions/openrouter-catalog-filter/state.test.ts:53-54` | 이번 RR-06·RR-02 수정이 재리뷰 세션 ID인 `RR-06`과 `the old "expected true or false"`라는 과거 문구 비교를 코드 주석에 남겼다. 현재 동작만 설명하면 충분하므로, 판·세션 이력을 주석에 쓰지 않는다는 기준에 어긋난다. | **수정(주석 정리)** — `RR-06` 라벨과 과거 문구 비교를 지우고, 뒤따르는 현재 동작 설명은 남긴다. 시험 로직이나 단정은 바꿀 필요가 없다. |

FC-01 외에 이번 수정이 새로 끌어들인 3절 덧대기, 2.9 과검증, 2.7 조용한 실패는 발견하지 못했다. RR-01의 EACCES 대역은 실제 파일 I/O 경계에만 있고 생산자·소비자 경로를 우회하지 않으며, RR-01과 RR-06의 두 시험쌍은 서로 다른 실패 분기와 공개 관측을 확인한다.

VERDICT: findings remain
