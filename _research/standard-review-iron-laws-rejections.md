# Iron Laws 기각 30건 독립 검토

## 0. 범위와 방법

- 대상: `_research/standard-disposition-iron-laws.md`의 "근거 있는 기각" 30건(IL-01–IL-48 중 기각분).
- 판정 기준: `docs/engineering-standard.md` 2.1, 2.2, 2.4, 2.6, 2.7, 2.9, 3, 4.
- 읽은 코드: 해당 지적의 함수와 **모든 호출자**, 그리고 같은 실패를 다루는 자매 경로(scores·state·settings 로더).
- 기준선: `feat/aaii-fallback-editor`의 `3bab77c`. 판정은 현재 작업 트리 코드로 했고, W1/W2가 같은 트리에서 "수정" 항목을
  고치는 중이라 감사 시점과 줄 번호가 다르다. 아래 줄 번호는 모두 **현재 작업 트리** 기준이며, 이동은 5절에 적었다.
  "수정" 항목 자체는 이 검토의 범위가 아니다.
- 이 검토는 읽기 전용이다. 제품 코드·시험·문서를 고치지 않았고 커밋하지 않았다. 이 파일만 새로 썼다.
  재현 스크립트는 OS 임시 디렉터리(`%TEMP%\ilreview`)에만 두었다.
- 처분 기록의 `IL-NN`은 규칙·파일·줄 순 정렬 번호이고 JSON 배열 순서와 다르다. 검토 전에 매핑을 스크립트로 확인했다.
- 판정은 "기각 사유가 사실과 맞는가"와 "그 사유가 정본 조항을 실제로 충족하는가" 두 가지로만 했다. 지적의 등급이나
  문구가 마음에 드는지는 보지 않았다.

## 1. 요약

| 판정 | 건수 | 항목 |
|---|---|---|
| 동의 | 22 | IL-01, IL-02, IL-04, IL-05, IL-11, IL-12, IL-13, IL-15, IL-17, IL-18, IL-24, IL-33, IL-38, IL-40–IL-48 |
| 부분 동의 | 8 | IL-06, IL-08, IL-09, IL-10, IL-14, IL-29, IL-30, IL-31 |
| 불동의 | 0 | — |

- **IL-307 계열(IL-40–IL-47)의 기각은 모두 성립한다.** `undefined`를 돌려주는 파서의 호출자는 전부 이유를 보고한다
  (3.1의 표). 이 부분은 처분 기록의 판단이 정확하다.
- **무료 스냅샷 IL-301 계열(IL-29·IL-30·IL-31)은 "호출자가 보고한다"는 전제가 원인 구분까지 하지 않는다.**
  같은 변경이 `loadScores`(IL-34)와 `loadState`(IL-39)를 "ENOENT만 조용히, 나머지는 경로·이유와 함께"로 고쳤는데,
  무료 스냅샷만 세 원인을 한 값으로 접는다. 2.4의 "같은 종류의 처리는 같은 오류·보고 방식을 따른다"에 어긋난다.
- **ARC-201(IL-08–IL-13) 기각은 대체로 타당하지만, "규칙은 이미 모듈로 나갔다"는 서술은 과장이다.**
  `chooseTurnCandidate`는 순수 규칙인데 진입 파일에 남아 있고, 명령 처리기의 설정 쓰기 순서는 세 벌로 갈라져
  동작이 다르다. 이는 줄 수 문제가 아니라 2.4·2.6 문제이며, IL-10 기각 사유가 이를 덮지 못한다.
- **IL-14 기각의 "각자 문서화한 어휘"는 사실이 아니다.** 두 README는 `on`/`off`만 문서화하는데 코드는 서로 다른
  상위집합을 받는다(3.6).
- **AI-101 기각 5건 중 IL-06만 "이름 붙은 한 곳"이 사실이 아니다.** DashScope host가 `catalog.ts` 안에서 두 번,
  `providers.ts`에서 한 번 더 적힌다(3.5).
- 최종 판정: `some rejections must be revisited`.

## 2. 판정표

| ID | 규칙 | 현재 위치 | 판정 | 근거 요약 | 권고 |
|---|---|---|---|---|---|
| IL-01 | AI-101 | `aaii-router/candidates.ts:54` | 동의 | 프록시 기본 origin 한 곳, 설정으로 교체 가능, 개발 전용 주소 아님 | 유지 |
| IL-02 | AI-101 | `coding-fallback/fetch-scores.mjs:37` (감사 :39) | 동의 | HuggingFace 공개 데이터셋 API, 한 곳, 환경별 값 아님 | 유지 |
| IL-04 | AI-101 | `coding-fallback/providers.ts:41` | 동의 | tier 표의 데이터 행, 출처 주석, 미분류로 보고되는 동작 | 유지 |
| IL-05 | AI-101 | `openrouter-catalog-filter/index.ts:46` | 동의 | Pi가 배포하는 catalog 엔드포인트 한 곳, 환경별 dev 주소 아님 | 유지 |
| IL-06 | AI-101 | `quota-providers/catalog.ts:106` (감사 :105) | 부분 동의 | URL 리터럴은 한 곳이나 host 지식이 `:106`, `:185`, `providers.ts:76` 세 곳 | host를 baseUrl에서 도출 |
| IL-08 | ARC-201 | `aaii-router/index.ts` (708줄, 감사 729줄) | 부분 동의 | 줄 수만으로 분할 금지는 맞지만 파일은 진입·route·TUI 두 화면·명령 처리의 혼합 | 사유 정정 + TUI 분리 부채 |
| IL-09 | ARC-201 | `aaii-router/index.ts:510-708` (감사 :527) | 부분 동의 | 조립 루트는 맞지만 순수 선택 규칙 `chooseTurnCandidate`가 진입 파일에 남음 | 규칙을 모듈로 이동(부채) |
| IL-10 | ARC-201 | `aaii-router/index.ts:581-708` (감사 :598) | 부분 동의 | shell은 맞지만 설정 쓰기 순서가 3벌, 동작이 서로 다름 | 공통 커밋 헬퍼로 추출 |
| IL-11 | ARC-201 | `coding-fallback/free-fetch.ts:88` | 동의 | 신선도 확인→프로브→쓰기→메시지의 한 흐름, 순수 부분 분리됨 | 유지 |
| IL-12 | ARC-201 | `coding-fallback/index.ts:208` | 동의 | 위저드 한 흐름, `claimNames`·`validate*`·`describeBatch` 분리됨 | 유지 |
| IL-13 | ARC-201 | `openrouter-catalog-filter/index.ts:305-387` (감사 :247) | 동의 | 조립 루트 한 책임, 83줄 그대로 | 유지 |
| IL-14 | ARC-204 | `aaii-router/settings.ts:185` ↔ `openrouter-catalog-filter/state.ts:41` | 부분 동의 | 통합은 부적절하나 "각자 문서화한 어휘"는 거짓, 수용 어휘가 실제로 갈림 | 어휘 정렬 또는 문서화 |
| IL-15 | ARC-204 | `coding-fallback/register.ts:189` ↔ `:223` | 동의 | 패턴·필드·메시지가 다른 별개 검사, 통합은 전달용 간접화 | 유지 |
| IL-17 | ARC-205 | `coding-fallback/fetch-scores.mjs:63-65` (감사 :67) | 동의 | 반복은 모델 slug 매핑 데이터, 코드 상수 아님 | 유지 |
| IL-18 | IL-111 | `coding-fallback/listing.ts:31` | 동의 | `os.environ/NAME` 문법 설명, 비밀 값 없음 | 유지 |
| IL-24 | IL-301 | `aaii-router/settings.ts:260,263` | 동의 | 깨진 JSON·비객체 모두 note로 보고, status가 출력 | 유지 |
| IL-29 | IL-301 | `coding-fallback/free-fetch.ts:75-81` | 부분 동의 | 비교 전용·쓰기 실패 보고는 맞지만 읽기 원인을 모두 접음 | ENOENT 외 이유 보고 |
| IL-30 | IL-301 | `coding-fallback/free-models.ts:301` | 부분 동의 | 파서 계약은 맞지만 "호출자는 IL-34에서 고친다"는 인용이 틀림 | 사유 정정 |
| IL-31 | IL-301 | `coding-fallback/free-models.ts:331-337` | 부분 동의 | 보수적 결과는 맞지만 ENOENT·권한·깨진 JSON을 구분하지 않음 | ENOENT만 조용히, 나머지 throw |
| IL-33 | IL-301 | `coding-fallback/scores.ts:82-86` | 동의 | 파서 계약, 호출자 `loadScores`가 경로·이유와 함께 throw | 유지 |
| IL-38 | IL-301 | `openrouter-catalog-filter/state.ts:76-92` | 동의 | 깨진 JSON·모양 오류를 note로 보고, report가 출력 | 유지 |
| IL-40 | IL-307 | `aaii-router/settings.ts:179` | 동의 | 호출자 `editSetting`이 `not a duration`으로 보고 | 유지 |
| IL-41 | IL-307 | `aaii-router/settings.ts:183` | 동의 | 위와 같음 | 유지 |
| IL-42 | IL-307 | `aaii-router/settings.ts:191` | 동의 | `editSetting`이 `expected on or off`로 보고 | 유지(문구 보완) |
| IL-43 | IL-307 | `aaii-router/settings.ts:192` | 동의 | 위와 같음 | 유지(문구 보완) |
| IL-44 | IL-307 | `coding-fallback/chain.ts:254` | 동의 | 체인이 아직 없을 때 `[]`는 정확한 값, 블록 부재는 compose가 먼저 거부 | 유지 |
| IL-45 | IL-307 | `coding-fallback/scores.ts:80` | 동의 | 파서 계약, 호출자 `loadScores`가 처리 | 유지 |
| IL-46 | IL-307 | `openrouter-catalog-filter/state.ts:43` | 동의 | `parseState`·`resolveState`가 note로 보고 | 유지(문구 보완) |
| IL-47 | IL-307 | `openrouter-catalog-filter/state.ts:44` | 동의 | 위와 같음 | 유지(문구 보완) |
| IL-48 | PERF-102 | `aaii-router/settings.ts:207` (감사 :211) | 동의 | 운영자가 입력한 소수 origin 목록, 증가 경로 없음 | 유지 |

## 3. 부분 동의 항목

### 3.1 IL-307 `undefined` 파서 — 호출자 보고 감사

집중 질문 (1)에 대한 답이다. `undefined`를 돌려주는 파서와 그 호출자를 전부 확인했다.

| 파서 | 반환 | 호출자 | 이유 보고 |
|---|---|---|---|
| `parseDuration` (`settings.ts:173`) | `undefined` | `editSetting:224`, `parseSettings:296-299` | `not a duration: <raw>` / `ignored "<key>": ...` |
| `parseToggle` (`settings.ts:185`) | `undefined` | `editSetting:230`, `parseSettings:296-299` | `expected on or off, got: <raw>` / `ignored "<key>": ...` |
| `parseScores` (`scores.ts:80`) | `undefined` | `loadScores:124-126` | `invalid scores <path>: malformed JSON or unusable snapshot` throw |
| `parseSwitch` (`state.ts:41`) | `undefined` | `parseState:88-90`, `resolveState:113-116` | note 두 곳, report가 출력 |
| `readExistingOrder` (`chain.ts:248`) | `[]` | `compose` 한 곳 (`chain.ts:536`) | 해당 없음 — `[]`는 "기존 순서 없음"이라는 도메인 값 |

- 결론: **IL-307 계열 기각은 성립한다.** `undefined`는 "알아볼 수 없는 값"이라는 계약이고, 호출자가 그 사실을
  사용자 문구나 예외로 바꾼다. `readExistingOrder`의 `[]`도 파싱 실패가 아니라 "아직 그 체인이 없다"이다.
- 예외 하나: `parseFreeSnapshot`/`loadFreeSnapshot`은 IL-307이 아니라 IL-301 계열인데, 처분 기록이 같은 논리
  ("호출자가 결정한다")로 묶었다. 이쪽 호출자는 **원인을 구분해 보고하지 않는다**(3.2). 파서 계약 자체는 문제가
  아니므로 IL-30은 기각을 유지하되, 근거의 인용을 바로잡아야 한다.

### 3.2 IL-31 — 무료 스냅샷 읽기 실패 (부분 동의)

- 기각 사유: "스냅샷을 못 읽으면 model_list를 그대로 두고 그 사실을 알린다(`config.ts:57`). 결과가 보수적이고
  사용자에게 드러난다."
- 사실 확인: 결과가 보수적인 것은 맞다(`config.ts:55-59`). 그러나 `loadFreeSnapshot`은 **ENOENT·EACCES·EISDIR·
  깨진 JSON을 모두 `undefined`로 접는다**(`free-models.ts:331-337`). 호출자의 문구는
  "no free-model snapshot could be read ... (a missing snapshot is not evidence that a promo ended)"로, 원인을
  구분하지 않고 "없음"을 암시한다.
- 같은 변경의 자매 경로와 비교:
  - `loadScores`(`scores.ts:116-127`): ENOENT만 빈 표, 그 밖의 읽기 오류는 `cannot read scores <path>: <reason>`,
    깨진 JSON은 `invalid scores <path>: ...`로 throw.
  - `loadState`(`state.ts:175-180`): ENOENT 외 오류를 note로 보고.
  - 재현: `loadFreeSnapshot`은 corrupt/missing/EISDIR 모두 `undefined`, `loadScores`는 corrupt와 EISDIR에 각각
    다른 메시지로 throw(6절).
- 실패 시나리오: 운영자가 `free-models.json`의 권한을 잘못 주거나 같은 이름의 디렉터리를 만들어 둔 상태에서
  `coding-fallback sync`를 실행한다. 출력은 "no free-model snapshot could be read"뿐이라 운영자는 파일이 없다고
  진단하고, 실제로 존재하는 파일의 권한·경로 문제를 찾지 못한다. 프루닝은 보류되므로 데이터 손실은 없지만,
  2.7의 "실패는 원인별 이유 코드로 드러낸다"를 충족하지 못한다.
- 권고: `loadFreeSnapshot`에서 ENOENT만 `undefined`, 그 밖의 읽기 오류는 경로와 이유를 담아 throw한다.
  깨진 JSON은 `invalid free snapshot <path>`로 throw하거나 note에 경로를 넣는다. `config.ts`는 그 이유를 notice에
  넣고 model_list를 그대로 두는 현재 동작을 유지한다. 시험은 corrupt/권한 오류/디렉터리 3분기.
  (W1 소유 파일이고 "수정" 항목과 같은 함수군이므로, 이번 변경에 합칠 수 있으면 합치고 아니면 부채로 남긴다.)

### 3.3 IL-29 — 이전 스냅샷 읽기 (부분 동의)

- 기각 사유: "이전 스냅샷은 변화 여부 비교에만 쓰인다. 읽지 못하면 새로 조회한 스냅샷으로 대체하고, 쓰기 실패는
  따로 보고한다."
- 사실 확인: 비교 전용과 쓰기 실패 보고는 맞다(`free-fetch.ts:100-102,141,157-164`). 그러나 `readExisting`이
  **모든 읽기 오류를 `undefined`로 접어** "파일 없음(첫 실행)"과 "읽기 실패(권한·디렉터리)"를 구분하지 않는다.
- 결과: 신선도 창(`:102`)이 무효가 되어 매 세션 재조회한다(비용). 깨진 파일은 조용히 덮어쓴다(복구 효과는 있지만
  이유를 말하지 않는다). 재현에서 corrupt/missing/EISDIR 세 경우의 `refreshFreeSnapshot` 메시지가 경로만 다르고
  동일했다(6절).
- 실패 시나리오: 스냅샷을 읽을 수 없는 상태에서 프로브도 실패하면 "no listing could be read ... the snapshot at
  <path> is unchanged"라고만 나온다. 운영자는 "스냅샷이 최신이라 안 바뀐 것"으로 읽지만, 실제로는 이전 스냅샷을
  읽지 못해 비교 자체를 못 한 것이다.
- 권고: ENOENT만 무시하고, 그 밖의 오류는 `failures` 또는 메시지에
  `could not read previous snapshot <path>: <reason>`으로 붙인다. 쓰기 경로는 그대로 둔다. 심각도는 낮지만
  IL-31과 같은 규칙(2.7)으로 고치는 것이 일관적이다.

### 3.4 IL-30 — 무료 스냅샷 파서 계약 (부분 동의)

- 기각 사유: "파싱 API의 `undefined`는 '쓸 수 있는 스냅샷 아님'이며 호출자가 결정한다. 문제는 호출자 쪽(IL-34)에서
  고친다."
- 파서 계약 자체는 맞다. `parseFreeSnapshot`(`free-models.ts:301-324`)의 `undefined`는 `parseScores`와 같은
  "사용할 수 없는 텍스트"이고, 파서가 경로를 모르므로 경로를 넣을 수도 없다.
- 그러나 **인용이 틀렸다.** IL-34는 `scores.ts`의 `loadScores`이고, 무료 스냅샷의 호출자는
  `loadFreeSnapshot`(IL-31)과 `free-fetch.ts`의 `readExisting`(IL-29)이다. 둘 다 기각되었으므로, 이 기각문대로면
  호출자 쪽 문제는 아무 데서도 고쳐지지 않는다.
- 권고: IL-30은 기각을 유지하되 근거를 "파서 계약"만으로 한정하고, 호출자 처리는 IL-29·IL-31에서 다룬다.
  파서 코드는 바꾸지 않는다.

### 3.5 IL-06 — DashScope host 중복 (부분 동의)

- 기각 사유: "환경마다 바뀌는 개발 주소가 아니라 외부 서비스의 고정 공개 엔드포인트이며, 각각 이름 붙은 한 곳에 있다."
- URL 리터럴은 한 곳이 맞다(`catalog.ts:106`). 그러나 **host 지식은 한 곳이 아니다**:
  - `catalog.ts:106`의 `baseUrl` 안,
  - `catalog.ts:185`의 `EXCLUDED_MODELS[].host`,
  - `providers.ts:76`의 tier 표 host.
- `EXCLUDED_MODELS[].host`는 `quota-providers/index.ts:87`에서 그대로 출력된다.
- 실패 시나리오: 지역 엔드포인트가 바뀌어 `baseUrl`만 고치면, 제외 목록의 report는 더 이상 존재하지 않는 host를
  가리키고, `tierForHost`는 새 host를 미분류로 본다. 같은 파일 안에서 계산 가능한 값을 다시 적었기 때문에 생기는
  드리프트다(2.4 "파생값은 복사하지 않고 그 출처에서 계산한다").
- 권고: AI-101 지적(URL 하드코딩)은 기각하되, `EXCLUDED_MODELS.host`를
  `parseProviderUrl(DASHSCOPE.baseUrl)?.hostname`으로 도출한다. 이번 변경에서 ExpLabs에 이미 적용한 N1 패턴과
  같은 수정이다. `providers.ts`의 tier 표는 **분류 데이터**라 host 키를 유지하는 것이 맞다(IL-04 동의와 같은 이유).

### 3.6 IL-14 — on/off 어휘 불일치 (부분 동의)

- 기각 사유: "서로 다른 확장이 각자 문서화한 설정 어휘를 읽는다(aaii-router는 on/true/yes/1, openrouter는
  enable/disable도 받음). 합치려면 무관한 두 확장 사이에 의존을 만들거나 공용 모듈을 새로 만들어야 한다."
- **뒷부분(통합 비용)은 맞고, 앞부분(문서화)은 틀렸다.**
  - `aaii-router/README.md:282`: `PI_AAII_ROUTER_VISION`, `PI_AAII_ROUTER_STATUS`를 "`on`/`off`"로만 문서화.
  - `openrouter-catalog-filter/README.md:86`: `PI_OPENROUTER_FILTER=on|off`로만 문서화.
  - 코드: aaii `TOGGLE_ON {on,true,yes,1}` / `TOGGLE_OFF {off,false,no,0}`(`settings.ts:164-165`),
    openrouter는 여기에 `enable,enabled` / `disable,disabled`를 더 받는다(`state.ts:37-38`).
  - 설정 UI도 `on`/`off`만 보여 준다(`settings.ts:88,96`). `set` 자동완성의 제안 값도
    `vision: ["on", "off"]`, `status: ["on", "off"]`뿐이다(`settings.ts:441-445`).
  - 재현: `parseToggle("enable") === undefined`, `parseSwitch("enable") === true`(6절).
- 정본 2.4: 같은 종류의 처리는 같은 인터페이스·오류·저장 방식을 따른다. 한 저장소의 두 확장이 같은 "켜기/끄기"를
  다른 어휘로 받아들이는 것은 기록해 둘 사용자 차이가 아니라 **일관성 결함**이다. 특히 오류 문구가
  "expected on or off"여서, 실제로 받는 `true`/`yes`/`1`을 알려주지 않는다(IL-42·IL-43·IL-46·IL-47의 문구 보완과
  같은 문제).
- 다만 "공용 함수로 통합"은 옳지 않다. 6줄짜리 파서를 위해 두 확장 사이에 의존을 만들거나 전달만 하는 모듈을
  두는 것은 2.1 결합도·2.2 간접화에 어긋난다. **기각(통합 안 함)은 유지하되, 어휘를 맞추거나 양쪽 README에
  차이를 명시해야 한다.**
- 실패 시나리오: 운영자가 `PI_OPENROUTER_FILTER=enable`을 쓰던 습관대로 `PI_AAII_ROUTER_VISION=enable`을
  내보낸다. 한쪽은 켜지고 다른 쪽은 note와 함께 무시되어, 같은 단어가 확장마다 다른 결과를 낸다.
- 권고: 수용 어휘를 하나로 정렬한다(예: `on/off/true/false/yes/no/1/0`). 의미 변경이므로 2.8에 따라 README·
  시험·오류 문구를 함께 바꾸고 처분 기록에 적는다. 정렬이 정말 싫으면 양쪽 README에 차이를 문서화하고
  기각 사유를 "문서화된 차이"로 고쳐야 한다. 현재 사유는 사실과 다르다.

### 3.7 IL-10 — 설정 쓰기 3벌 (부분 동의)

- 기각 사유: "확장 진입 파일과 명령 처리기는 2.6의 imperative shell이며, 규칙은 이미 모듈로 나가 있다."
- shell인 것은 맞다. 그러나 처리기 안에 **같은 "설정 저장" 지식이 세 벌** 있고 동작이 다르다.
  - 설정 창(`index.ts:427-446`): 저장 → `routingChanged`면 epoch bump → `forget()` →
    `publishStatus(..., false)`로 상태 줄 지움 → 저장 알림 → env가 잡고 있는 키 경고.
  - `set`(`:627-643`): 저장 → bump → forget → 해당 키의 env 우선만 인라인으로 알림. **상태 줄을 지우지 않는다.**
  - `reset`(`:652-661`): 저장 → bump → forget → "defaults written". **상태 줄도 지우지 않고, env 우선 경고도 없다.**
- 정본 2.4는 같은 종류의 처리가 같은 순서·보고 방식을 따르라고 한다. 세 경로의 차이는 이유가 적혀 있지 않다.
- 실패 시나리오: `PI_AAII_ROUTER_VISION=on`을 내보낸 채 `/aaii-router reset`을 실행한다. 화면에는
  "defaults written"만 나오지만 vision은 여전히 env 값이 이기고, 상태 줄은 다음 요청 전까지 이전 후보를 보여 준다.
  같은 reset을 설정 창에서 하면 env 경고가 나온다(415, 443-446). 진입점에 따라 결과가 다르다.
- 권고: "저장→epoch→cache 무효화→상태 줄 갱신→env 우선 보고"를 한 헬퍼(예: `commitSettings(ctx, before, after)`)로
  뽑아 세 곳에서 부른다. 하위 명령 분기는 shell에 남긴다. 이것은 줄 수를 맞추는 분할이 아니라 2.4 중복 제거다.
  W1이 같은 파일을 고치는 중이므로 이번 변경에 합칠 수 있으면 합치고, 아니면 부채로 기록한다.

### 3.8 IL-09 — 조립 루트와 순수 규칙 (부분 동의)

- 기각 사유: "확장 진입 파일은 2.6의 imperative shell이며, 규칙은 이미 settings·chain-order·candidates·cooldown·
  fallback-editor로 나가 있다."
- 절반만 맞다. 진입 함수(`:510-708`, 약 199줄)는 가상 모델 등록과 `route`(`:516-572`), 명령 등록을 함께 갖는다.
  `route`의 continuation·retry·epoch 선택은 흐름 조율이지만, **`chooseTurnCandidate`(`:169-187`)는 순수 선택
  규칙**인데 진입 파일에 남아 있고 `index.test.ts`의 요청 시험으로만 간접 검증된다. "규칙은 이미 나갔다"는
  서술은 이 함수를 설명하지 못한다.
- 203줄이라는 지적 자체는 줄 수 지적이므로 2.1에 따라 기각할 수 있다. 그러나 2.6의 functional core 분리는
  별개 문제다.
- 권고: 줄 수 기각은 유지한다. 부채로 `chooseTurnCandidate`(가능하면 continuation/retry 선택 분기까지)를
  `chain-order.ts` 또는 `cooldown.ts`로 옮기고 직접 시험한다. `route`를 줄 수로 쪼개지는 않는다.

### 3.9 IL-08 — 708줄 파일 (부분 동의)

- 기각 사유: "정본 2.1은 줄 수를 맞추려는 기계적 분할을 금지한다. ... 확장 진입 파일과 명령 처리기는 2.6의
  imperative shell이다."
- 줄 수만으로 나누지 말아야 한다는 원칙은 맞다. 그러나 이 파일은 한 흐름이 아니라 **조립 루트 + route 정책 +
  TUI 설정 화면(`:394-448`) + TUI 폴백 편집기(`:450-508`) + 명령 분기**를 함께 갖는다. "shell"이라는 한 단어로
  덮기에는 책임이 넷이다.
- 반대로, 600줄에 맞추려고 자르는 것도 답이 아니다. TUI 두 화면을 각자의 모듈로 옮기는 것은 책임 기준 분리이지
  줄 수 맞추기가 아니다.
- 권고: 기각 사유를 "파일 줄 수 자체는 위반 근거가 아니다"로 좁히고, TUI 화면 분리를 부채로 기록한다. 급하지
  않으며 이번 변경 범위 밖이다.

## 4. 동의 항목의 근거

### 4.1 AI-101 (IL-01, IL-02, IL-04, IL-05)

- **IL-01** `DEFAULT_EXCLUDED_ORIGINS = ["http://127.0.0.1:4000"]`(`candidates.ts:54`)는 이 확장이 배제하려는
  LiteLLM 프록시의 기본 origin이고, 설정 `origins`로 교체된다. 제품 코드에서 유일한 발생이다. 개발 PC 전용
  주소가 아니라 기본 계약값이므로 AI-101의 "환경마다 바뀌는 주소"에 해당하지 않는다.
- **IL-02** 감사 시점 `fetch-scores.mjs:39`는 현재 `:37`의 `const API = "https://huggingface.co"`다(줄 이동 −2,
  열 13로 확인). HuggingFace 데이터셋 API는 배포 환경별로 바뀌지 않고 한 곳에만 있다.
- **IL-04** `PROVIDER_TIERS`(`providers.ts:39-...`)의 `100.78.239.122`는 운영자의 tailnet 주소를 분류하는
  **데이터 행**이고 출처 주석이 붙어 있다. 주소가 바뀌면 `tierForHost`가 `TIER_UNKNOWN`을 돌려주고 report가
  미분류로 보여 준다. 코드 상수 중복이 아니다.
- **IL-05** `CATALOG_URL = "https://pi.dev/api/models/providers/openrouter"`(`openrouter/index.ts:46`)는 Pi가 배포하는
  catalog 엔드포인트 한 곳이고, 오프라인 경로는 `PI_OFFLINE`으로 이미 분리돼 있다.

### 4.2 ARC-201 (IL-11, IL-12, IL-13)

- **IL-11** `refreshFreeSnapshot`은 신선도 확인→프로브→스냅샷 조립→쓰기→메시지의 한 흐름이다. 순수 부분은
  `probe`·`buildProviderSnapshot`·`buildFreeSnapshot`·`payloadOf`로 나가 있다. 프롬프트 없이 순서를 자르면
  상태 전달만 하는 단계가 생긴다.
- **IL-12** `addWithWindow`는 upstream 선택→slug 입력→후보 조회→피커→이름 검증→확인→쓰기의 한 위저드다.
  `claimNames`, `validateSlug`, `validateGroupName`, `describeBatch`가 이미 분리돼 있다.
- **IL-13** `openrouter/index.ts`의 기본 export는 provider 등록과 명령 분기를 묶는 조립 루트다. 감사 시점 83줄,
  현재도 83줄(`:305-387`)로 같은 책임이다. W2의 IL-36/37 수정은 그 앞의 catalog 로딩에 `skipped`를 더했고
  shell의 구조를 바꾸지 않았다.

### 4.3 ARC-204·ARC-205·IL-111·PERF-102 (IL-15, IL-17, IL-18, IL-48)

- **IL-15** `validateModelId`(`register.ts:189`)는 `MODEL_ID`와 "letters, digits, dot, dash and slash", `validateSlug`
  (`:223`)는 `SLUG`와 "lowercase letters, digits and dashes"다. 필드·패턴·메시지가 다르고, 같은 파일의
  `validateGroupName`(`:207`)은 체인 일치·생성 접두사까지 본다. 셋을 합치면 패턴·이름·메시지를 인자로 넘기는
  전달용 계층이 된다(2.2).
- **IL-17** `qwen3-7-max` 반복은 `TARGETS`의 (LiteLLM 키 ↔ AA creator/slug) 매핑 데이터다. 같은 slug가 기본
  항목과 `fallback` 항목에 함께 나오는 것은 매핑의 의미이지 상수 중복이 아니다. 스냅샷 파일의 반복도 생성 데이터다.
- **IL-18** `listing.ts:31` 주석은 `os.environ/NAME` 문법을 설명한다. 값이 아니라 문법이며 비밀도 없다.
- **IL-48** `parseOrigins`의 `origins.includes`는 운영자가 쉼표로 적는 소수 목록을 도는 반복이다. 입력 크기가
  커질 경로가 없고, `Set`으로 바꾸는 것은 이 정본의 판정 대상이 아니다.

### 4.4 IL-301 (IL-24, IL-33, IL-38)

- **IL-24** `parseSettings`는 깨진 JSON(`:260`)과 비객체(`:263`) 모두 note를 돌려주고, `currentSettings`가 모아
  `report`가 `! note`로 출력한다(`index.ts:225,334`). 조용한 대체가 아니다.
- **IL-38** `parseState`는 깨진 JSON·비객체·필드 없음·잘못된 값을 각각 note로 돌려주고(`state.ts:79,82,86,90`),
  `resolveState`가 모아 report가 출력한다. W2가 `loadState`의 읽기 오류까지 보고하도록 고쳐(IL-39) 파일 경계도
  덮인다.
- **IL-33** `parseScores`의 JSON catch는 `undefined`를 돌려주고, 유일한 호출자 `loadScores`가
  `invalid scores <path>: malformed JSON or unusable snapshot`으로 바꾼다(`scores.ts:124-126`). 재현으로 확인했다.

### 4.5 IL-307 (IL-40–IL-47)

- `parseDuration`·`parseToggle`은 `editSetting`에서만 값으로 쓰이고, 실패는 `:224`·`:230`의 사유 문자열이 된다.
  파일 로드 경로에서는 `parseSettings`가 `ignored "<key>": <reason>` note로 바꾼다(`:296-299`).
- `parseSwitch`는 `parseState`(`:88-90`)와 `resolveState`(`:113-116`) 두 호출자 모두 note를 남긴다.
- `readExistingOrder`의 유일한 호출자는 `compose`(`chain.ts:536`)이고, 호출 전에 `fallbacks` 블록 존재를
  검사한다(`:513-514`). 따라서 `start < 0`의 `[]`는 "그 체인이 아직 없다"는 정확한 값이다. 덧붙여 `:250`의
  `if (!block) return []`은 유일 호출자 기준으로 도달 불가능한 방어이므로 2.7의 과방어 후보지만, IL-44가 지적한
  줄은 아니다.
- 문구 보완: `expected on or off`는 실제 수용 어휘(`true`, `yes`, `1`)를 알려주지 않는다. IL-14의 어휘 정렬과
  함께 문구를 맞추는 것이 좋다.

## 5. 검토 중 바뀐 사이트

- **IL-08**: 감사 729줄 → 현재 708줄. W1이 `setStatus` try/catch(IL-21·IL-22)를 지우면서 줄었다. 여전히 600줄 초과.
- **IL-09**: 감사 203줄 → 현재 약 199줄(`:510-708`). 같은 이유로 줄었고 구조는 그대로다.
- **IL-10**: 감사 119줄 → 현재 128줄(`:581-708`). W1 수정과 함께 늘었지만 3벌 구조는 그대로다.
- **IL-13**: 감사 `:247` 83줄 → 현재 `:305-387` 83줄. W2의 IL-36/37 수정이 앞쪽 catalog 로딩을 키워 위치만
  이동했고, shell 자체는 그대로다(내부 두 줄은 `formatCatalogSource` 인자 변경).
- **IL-06**: 감사 `:105` → 현재 `:106`. W1의 ExpLabs 상수 통합으로 한 줄 이동.
- **IL-14**: 코드·README 모두 그대로. 다만 W1이 `settings.ts`의 `originOf`를 `parseProviderUrl` 위로 합치면서
  `parseToggle`이 `:189` → `:185`로 이동했다.
- **IL-29·IL-30·IL-31·IL-33**: 해당 함수는 그대로다. 자매 경로인 `loadScores`(IL-34)와 `loadState`(IL-39)가
  이번 변경으로 원인을 구분하게 되면서, 무료 스냅샷과의 **불일치가 새로 드러났다**.
- **IL-01**: W1이 `candidates.ts`의 `originOf`/`hostOf`를 공용 `parseProviderUrl`로 합쳤지만(IL-19·20·23·26),
  `DEFAULT_EXCLUDED_ORIGINS`는 그대로다.
- 작업 트리는 W1/W2 수정으로 dirty하고, 이 검토는 아무것도 커밋하지 않았다.

## 6. 재현

- 스크립트: `%TEMP%\ilreview\probe.mjs` (Node 26 타입 스트리핑으로 제품 모듈을 직접 import, `%TEMP%\ilreview\data`에
  corrupt/missing/디렉터리 픽스처 생성). 제품 파일은 읽기만 한다.
- 핵심 출력:

```text
parseToggle(enable)              undefined
parseSwitch(enable)              true
parseSettings(broken).notes      ["the settings file is not valid JSON; defaults are in force"]
parseState(broken)               {"notes":["the state file is not valid JSON; its setting was ignored"]}
loadFreeSnapshot(corrupt)        undefined
loadFreeSnapshot(missing)        undefined
loadFreeSnapshot(dir)            undefined
loadScores(corrupt) throws       "invalid scores ...: malformed JSON or unusable snapshot"
loadScores(dir) throws           "cannot read scores ...: EISDIR: ..."
refreshFreeSnapshot(corrupt)     no listing could be read (...); the snapshot at ...corrupt.json is unchanged
refreshFreeSnapshot(missing)     no listing could be read (...); the snapshot at ...missing.json is unchanged
refreshFreeSnapshot(dir)         no listing could be read (...); the snapshot at ...asdir is unchanged
```

- 해석: 3.2–3.4의 "원인 구분 없음"과 3.6의 "어휘 불일치"를 그대로 재현한다. `loadScores`/`loadState` 쪽은
  같은 픽스처에서 원인을 구분한다.

## 7. 권고 처분

| ID | 조치 | 내용 |
|---|---|---|
| IL-31 | 수정 | `loadFreeSnapshot`: ENOENT만 `undefined`, 그 밖의 읽기 오류는 경로·이유와 함께 throw. 깨진 JSON은 경로를 포함해 보고 |
| IL-29 | 수정 | `readExisting`: ENOENT만 무시, 그 밖의 오류는 메시지에 "could not read previous snapshot <path>: <reason>" |
| IL-30 | 사유 정정 | 파서 계약 기각은 유지. "호출자는 IL-34에서 고친다"를 "IL-29·IL-31에서 다룬다"로 고침 |
| IL-06 | 수정 | `EXCLUDED_MODELS[].host`를 `parseProviderUrl(DASHSCOPE.baseUrl)?.hostname`으로 도출(N1 패턴) |
| IL-14 | 수정 또는 문서화 | 수용 어휘를 하나로 정렬하고 README·시험·오류 문구를 함께 고침. 유지하려면 양쪽 README에 차이를 명시하고 기각 사유를 "문서화된 차이"로 |
| IL-10 | 수정 | 설정 저장·epoch·cache 무효화·상태 줄·env 경고를 한 헬퍼로 추출해 세 진입점이 같은 순서를 따르게 함 |
| IL-09 | 부채 | `chooseTurnCandidate`를 선택 모듈로 옮기고 직접 시험. `route`는 줄 수로 쪼개지 않음 |
| IL-08 | 사유 정정 + 부채 | "줄 수 자체는 위반 근거가 아니다"로 좁히고, TUI 두 화면 분리를 부채로 기록 |
| IL-42, IL-43, IL-46, IL-47 | 문구 보완 | `expected on or off`에 실제 수용 어휘를 표시(IL-14 정렬과 함께) |

- 위 수정은 W1/W2가 현재 소유한 파일이다. 이 검토는 읽기 전용이므로 적용하지 않았고, "수정" 항목의 진행을
  방해하지 않도록 부채/후속으로 넘기는 것을 권한다.
- 나머지 22건은 기각을 유지한다.

VERDICT: some rejections must be revisited
