# W7 보고서 (pi) — RR-02 · RR-03(openrouter) · RR-05 · RR-06

- 스킬: `engineering-standard`를 불러왔다(`C:\Users\airgu\.pi\agent\skills\engineering-standard\SKILL.md`).
- 정본 `docs/engineering-standard.md`를 전부 다시 읽었고, `_research/standard-disposition-iron-laws.md`의
  "재리뷰 반영" 절과 `_research/standard-rereview-iron-laws.md`를 읽었다.
- 소유 파일만 수정했다: `openrouter-catalog-filter/`의 `state.ts`, `state.test.ts`, `index.ts`, `index.test.ts`,
  `README.md`, `quota-providers/catalog.test.ts`. commit·stash·reset 등 git 조작, 네트워크 호출,
  `~/.pi/agent/*.json` 접근 없음.

## 수행 내역

### RR-02 — `state.ts` 오류 문구가 실제 받는 어휘를 말하게 (의미 변경: 문구)

- 수정 전: 파일 값 `expected true or false`, 환경 값 `expected on or off`. 실제로는 `parseSwitch`의
  `ON`/`OFF` 집합 12단어를 받고, 파일 값은 JSON 불리언도 받으므로 안내가 계약과 달랐다.
- 수정 후: 공용 모듈을 만들지 않고 이 모듈 안에서 `SWITCH_WORDS = [...ON, ...OFF].join(", ")`로
  받는 단어 목록을 도출해 두 문구가 쓴다.
  - 파일 값: `` ignored "enabled": expected a JSON boolean or one of ${SWITCH_WORDS}, got <값> ``
  - 환경 값: `` ignored ${STATE_ENV}: expected one of ${SWITCH_WORDS}, got <값> ``
  파일 값은 JSON 불리언도 받는다는 점이 문구에 드러난다. 단어 순서는 aaii-router N5의 나열과 같다.
- `state.test.ts`: 옛 문구 기대 2곳을 전체 리터럴로 갱신했다(`assert.equal`/`deepEqual`, 제품 상수를
  가져오지 않음 — 변수명은 `PI_OPENROUTER_FILTER` 리터럴로 적음).
- `README.md`: 이미 환경 변수 어휘가 문서화돼 있어 이 항목으로는 바꾸지 않았다.

### RR-03 — `index.ts` 호출자 없는 기본값 삭제 (동작 보존)

- `readStoredModels(skipped = [])`, `builtinFallbackModels(skipped = [])`의 기본값을 지우고 필수 인자로
  바꿨다. grep으로 유일 호출자 `loadCatalog`가 항상 인자를 넘기는 것을 확인했다.
- `applyAllowlist`의 `skipped = []`는 생략 호출자(`fetchRemoteCatalog`)가 실제로 있어 그대로 뒀다.

### RR-05 — 제품 소스 문자열 치환 시험 삭제 (2.9, 3절)

- `quota-providers/catalog.test.ts`의 "exclusion reporting follows a changed DashScope endpoint" 시험과
  그 시험에서만 쓰던 import(`readFile`, `writeFile`, `join`, `createModuleHarness`)를 지웠다.
  대체 시험을 만들지 않았다. N4(host가 `DASHSCOPE.baseUrl`에서 도출되는 단일 출처)는 코드 구조와
  W3의 일회 변이 기록으로 확인되며, 소스 표기에 묶인 상주 시험으로 다시 묶지 않는다.

### RR-06 — 비-ENOENT 저장본 읽기 실패의 계약 시험 (검증 추가)

- `index.test.ts`에 시험을 추가했다: `models-store.json` 자리에 디렉터리를 두고(`PI_OFFLINE=1`) 
  builtin 폴백(2 of 4)과 `store skipped: could not read <경로>: EISDIR` 보고를 단정한다. 기존
  ENOENT 시험("the file was missing")과 독립 기대값이다.
- `README.md`의 저장본 사유 문장에 "could not be read(경로·오류 보고, 디렉터리면 `EISDIR`)"를
  더했다. 기존 문장은 3개 구분만 적고 있어 이번에 계약 시험으로 닫은 분기가 문서에 없었다.

## 4절 보고 점검표

- **책임 소유**: 오류 문구는 그 값을 검사하는 `state.ts`(`parseState`·`resolveState`)가 소유하고,
  받는 어휘의 단일 출처는 이미 있는 `ON`/`OFF` 집합이다. 저장본 읽기 실패 구분은 `index.ts`
  `readStoredModels`가 소유하고, `loadCatalog`가 그 이유를 `skipped`로 보고 경로에 흘려 보낸다.
  RR-03으로 두 폴백 함수의 시그니처가 실제 호출 형태와 일치하게 됐다.
- **더한 것 / 뺀 것**: 더한 것 — `SWITCH_WORDS` 상수, RR-06 시험 1개, README 사유 문장 보강.
  뺀 것 — 옛 문구 2개(`expected true or false`/`expected on or off`), `readStoredModels`·
  `builtinFallbackModels`의 `= []` 기본값, 소스 치환 시험 1개와 그 전용 import 3개. 함께 고친
  호출 지점: 없음(두 함수의 호출자는 원래 인자를 넘기고 있었다).
- **3절 형태**: 없음. 새 경로를 덧대지 않았고, 지운 시험의 책임(단일 출처 확인)은 코드 구조와
  기록된 일회 변이 검사로 돌아갔다. 시험 파일의 `as unknown as ExtensionAPI`는 기존 SDK 대역의
  형 맞춤(외부 경계)이고, 제품의 `setTimeout`은 원격 조회 타임아웃(외부 경계)으로 둘 다 기존 것이다.
- **새 구조의 실제 역할과 소비자**: `SWITCH_WORDS`의 소비자는 잘못된 값을 넣은 사용자(문구)와
  그 문구를 리터럴로 고정하는 시험이다. RR-06 시험의 소비자는 저장본이 읽히지 못하는 운영자로,
  "파일 없음"과 "읽을 수 없음"이 다르게 보고되는지가 Pi 상태 줄에서 보인다.
- **시험 계약 한 줄과 mutation 결과**:
  - RR-02 (파일 값): 파일의 `"enabled"`가 불리언도 문자열 토글도 아니면, 받을 수 있는 JSON 불리언과
    12단어 전체를 이름으로 알린다. — mutation: 문구를 옛 `expected true or false`로 되돌리자
    리터럴 단정이 실패했다(killed, 원복).
  - RR-02 (환경 값): `PI_OPENROUTER_FILTER`의 잘못된 값은 받을 수 있는 12단어 전체를 알린다. —
    같은 리터럴 스타일이며, 파일 값 변이로 문구 고정이 잡히는 것을 확인했다.
  - RR-06: 저장본 경로가 디렉터리면(비-ENOENT) builtin으로 폴백하고, 건너뛴 저장본 이유에 경로와
    `EISDIR`이 남는다. — mutation: `readStoredModels`의 비-ENOENT 분기를 `the file was missing`으로
    접자 이 시험만 실패했다(killed, 원복).
  - RR-05: 시험 삭제라 mutation 대상 없음. 대신 소스 치환 시험이 지워진 뒤에도 catalog 시험 8개가
    같은 계약을 유지하는지 전체 실행으로 확인했다.
- **남긴 임시 코드**: 없음.
- **동작 보존 / 의미 변경**: RR-02는 의미 변경(사용자에게 보이는 문구). RR-03은 동작 보존
  (호출자가 이미 인자를 넘기므로 런타임 동작 불변). RR-05는 시험 삭제(제품 동작 불변). RR-06은
  검증 추가(제품 동작 불변).

## 수락 결과

- 명령(지정된 PowerShell 명령의 bash 동등 실행):
  `PI_OFFLINE=1 PI_CODING_FALLBACK_FREE_REFRESH=off node --test extensions/*/*.test.ts`
- 결과: **234 pass / 0 fail / 0 skip**.
- 개수: 기준 233 → 234. 내 기여는 −1(RR-05) + 1(RR-06) = 0이므로 +1은 동시 작업 중인 다른
  작업자(W6, aaii-router) 파일에서 온 것으로 보인다. 소유 밖이라 확인하지 않았고, 실패·skip 0이라
  건드리지 않았다.
- 자체 점검(절차 5단계의 grep): 소유 파일에 skip/xfail·환경 변수 게이트(시험용)·setTimeout 대기·
  시험 전용 export·import 감싸기·절대 경로·빈 `catch {}` 없음.
- Iron Laws 정적 분석과 독립 리뷰는 이번 변경 범위에 대해 코디네이터 단계에서 받을 항목이며,
  작업자로서는 수행하지 않았다(처분 기록에 이 보고서를 남긴다).
