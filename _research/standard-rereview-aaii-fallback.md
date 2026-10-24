# 독립 재리뷰 — aaii-router fallback 편집기 (수정 반영 후)

판정 기준: `docs/engineering-standard.md` (이하 "정본"). 이 문서만이 판정 기준이다.
범위 정정(사용자 지시): Iron Laws(2.10-1)와 MATLAB 관련 항목은 판정에서 제외하고, 2.10 완료 정의는
네 단계(소스·import·빌드 / 대역 통합 / 사용 가능한 실물 증거 / 실물 준비 완료)로만 판정한다.

리뷰 방식: 읽기 전용. 소스·시험·문서를 수정하지 않았고 커밋하지 않았다. 작성한 파일은 이 보고서 하나뿐이다.
임시 산출물(시험 출력)은 OS 임시 디렉터리(`%TEMP%`)에만 두었다.

검토 범위: `extensions/aaii-router/`의 `chain-order.ts`, `fallback-editor.ts`, `fallback-tui.ts`, `settings.ts`,
`index.ts`, `test-support.ts`, 모든 `*.test.ts`, `README.md`, 그리고 `extensions/coding-fallback/chain.test.ts`,
`free-models.test.ts`. 그 밖의 미커밋 변경은 실제 사용 경로에 닿는 부분만 보았다.

입력: `_research/standard-disposition-aaii-fallback.md`(처분표·mutation·코디네이터 발견·수정 차수),
`_research/standard-review-aaii-fallback.md`(F1–F14), `_research/mutation-check-aaii-fallback.md`(M01–M34).

## 0. 시험 실행 결과

```
node --test extensions/aaii-router/*.test.ts extensions/coding-fallback/*.test.ts
```

- **tests 191 / pass 191 / fail 0 / skipped 0 / todo 0 / cancelled 0** (duration 약 1.1s, exit 0)
- 글롭별 단독 실행: `extensions/aaii-router/*.test.ts` → **90 pass / 0 fail / 0 skip**,
  `extensions/coding-fallback/*.test.ts` → **101 pass / 0 fail / 0 skip**.
- skip이 0이라는 것은 처분표 F10+C1의 "env 게이트+skip으로 남은 라이브 시험"이 실제로 제거됐다는
  것을 확인해 준다(`extensions/` 아래 `PI_CODING_FALLBACK_LIVE_TESTS`·`LIVE_TESTS` 문자열 없음).

---

## 1. 처분표 "수정" 항목 재판정

| ID | 요지 | 재판정 | 근거 |
|---|---|---|---|
| F1 | 미리보기·행 정렬이 라우팅과 별도로 순서 규칙 재구현 | **resolved** | `fallback-editor.ts:51`(orderedRows)과 `:151`(pipelinePreview)이 모두 `applyChainSettings`를 호출. 순서 지식은 `chain-order.ts:4-19` 한 곳 |
| F2 + C5 | raw 키 매칭 + escape 버퍼가 SDK 중복, Kitty 미지원 | **resolved** | `fallback-tui.ts:27` 정적 import, `:126-159` `matchesKey`/`getKeybindings` 사용. `fallback-editor.ts:27-30`은 `EditorKey`만 받음. `ESCAPE_SEQUENCES`·`flushEscape`·50ms 버퍼 없음(전 소스 grep 0) |
| F3 + C2 | 체인 epoch 무효화가 경로마다 다르고 `chainKeys`가 `PROJECT_KEYS` 하드코딩 | **resolved** | `settings.ts:332` `PROJECT_KEYS`, `:335-344` `routingChanged`(라우팅 키 = `SETTING_KEYS` − `PROJECT_KEYS`). 네 경로가 사용: 설정 창 `index.ts:451`, 편집기 저장 `:511`, `set` `:650`, `reset` `:675` |
| F5 | 시험 이름에 "Finding N"/"H7" | **resolved** | `fallback-tui.test.ts`에 `Finding`/`H7` 문자열 0(전 소스 grep 0). 이름이 계약을 서술 |
| F6 + C4 | index/epoch 시험이 TUI 시험 파일에 있음 | **resolved** | `index.test.ts` 신설(204행, 명령·epoch·설정 창). `fallback-tui.test.ts:21-26`의 import에 `index.ts`·`chainEpoch` 없음 |
| F8 | 도달 불가 중복 후보 입력 + `ORIGINAL_ORDER ??` 죽은 폴백 | **resolved(일부 잔여는 NF2)** | 중복 *후보* 입력 시험 삭제, `fallback-editor.ts:84`가 `draft[ORIGINAL_ORDER]`(폴백 `??` 없음). 단 설정 목록 중복 라벨 시험은 남음 → NF2 |
| F9 | `savingRenders === 1` 호출 횟수 단정 | **resolved** | `fallback-tui.test.ts:297-324`: `attempts === 1`(중복 저장 방지, 실제 계약)만 유지, 렌더 횟수 단정 없음. 저장 중 표시는 `/saving…/` 가시성으로 관측 |
| F10 + C1 | fixture가 대체한 라이브 시험이 env 게이트+skip으로 잔존 | **resolved(삭제)** | 위 0절(0 skip, 문자열 0). fixture 시험 `chain.test.ts:278-284`, `free-models.test.ts:494-496`만 남음 |
| F11 + M20–M22 | `fallback`→저장→다음 요청, `set`, `reset` 무효화 배선 시험 없음 | **resolved** | `index.test.ts:121-135`(편집기 저장→다음 턴 후보), `:143-158`(`set` 4키), `:160-168`(`reset`), `:170-198`(설정 창/창 Reset). 실제 확장 등록·실제 핸들러·실제 파일 저장을 통과하고 다음 `route()`가 고른 후보를 관측 |
| F12 | 같은 "no eligible model" 메시지·guard 두 벌 | **resolved** | `route()`의 throw는 `index.ts:547-549` 한 곳. `chooseTurnCandidate`(`:169-187`)는 더 이상 throw하지 않음. `report()`의 다른 문구(`:353`)는 다른 소비자(명령 출력)라 중복 아님 |
| F13 + C3 | 시험 전용 export(`currentChainEpoch`/`bumpChainEpoch`), 소비자 없음 | **resolved** | `index.ts:159` `bumpChainEpoch`는 비공개, `currentChainEpoch` 없음. `SETTING_KEYS`(`settings.ts:27`)는 `routingChanged`(`:336`)에서 실제 소비 |
| M02 | 핀 역순 순회가 생존(입력 대칭) | **resolved** | `chain-order.test.ts:11` 핀 입력 `["provider/c","gone/model","provider/a","provider/b","provider/c"]`(비대칭), `:12` literal `["c","a","b","d"]`. 역순이면 `[c,b,a,d]`가 되어 실패 |
| M29, M34 | free 경로가 기존 항목 내용·블록 밖 설정 보존을 확인 안 함 | **resolved** | `free-models.test.ts:458-492` `assertGeneratedGroupAccepted`: `after.slice(0, routerAt)` 전체를 `before`와 비교(기존 `api_key` 등) + `request_timeout:` 이후 꼬리를 통째 비교. `FULL_CONFIG`(`:402-447`)에 `api_key`, `request_timeout: 120` 포함 |
| mut-1 | `pins lead`의 객체 동일성 단정 | **resolved** | `chain-order.test.ts:13` 값 기반 `assert.deepEqual(ordered[0], {...})` |
| mut-4 | TUI 렌더 공백·문구 전체 고정 | **resolved** | `fallback-tui.test.ts`가 부분 정규식(`/s save/`, `/\[P\]/`)·폭 클램프(`:284-289`)로 계약만 단정 |
| B2-1 | SDK import try/catch + 개발 PC 절대경로 + 손 사본 `matchesKey` + 기계 종속 시험 | **resolved** | `fallback-tui.ts:27` 정적 import, try/catch 없음. `extensions/`에 `airgu`·`releases/1.4.0`·`file:///C:` 0(grep). 시험 대역은 `test-support.ts` 한 곳 |
| B2-2 | `orderedRows`가 자체 정렬 후 `as unknown as Candidate` 왕복 | **resolved** | `chain-order.ts:4` `<T extends { readonly label: string }>` 제네릭, `fallback-editor.ts:51`이 행을 그대로 전달. `fallback-editor.ts`에 `as unknown as` 없음 |
| B3 | `index.ts`가 SDK를 try/catch 동적 import, 실패 시 `process.cwd()` 대체 | **resolved** | `index.ts:96` 정적 import(`VIRTUAL_MODEL_STATE_ENTRY`, `getAgentDir`), `process.cwd()` 0(grep). `index.test.ts:113-119`가 실제 `getAgentDir` 디렉터리에 쓰는지 검증 |

**결론(1): 처분표의 "수정" 항목은 모두 resolved다.** 유일한 잔여는 F8이 "실제로 도달 가능"하다고 남긴
설정 목록 중복 라벨 시험으로, 이는 아래 NF2에서 별도 지적한다.

---

## 2. "근거 있는 기각"·"부채 기록" 재판정

| ID | 처분 | 재판정 | 이유 |
|---|---|---|---|
| F14 | 근거 있는 기각 | **동의** | 라벨 규칙 하나를 `editSetting`·`parseSettings`·`resolveSettings`(env) 세 경로로 검사하는 것은 서로 다른 신뢰 경계(대화형 입력·파일·환경)이고, 세 경로가 모두 `editSetting`에 *위임한다는 사실*이 계약이다. `settings.test.ts:221`에 그 목적이 한 줄로 적혀 있다. 검출력을 늘리진 않지만 3절 형태의 "새 경로"가 아니라 위임 보증이므로 유지 근거가 있다 |
| F7 | 부채 기록 | **부분 동의** | `index.ts:307`의 `tier >= 99`는 실제로 `candidates.ts:170`(`=== TIER_UNKNOWN`)·`providers.ts:28`(`TIER_UNKNOWN = 99`)와 같은 지식을 두 곳에 적은 2.4 위반이다. 다만 git diff상 이 줄은 이번 변경에서 `const tier = …`로 추출만 되었고 `>= 99` 자체는 HEAD(`4861f9d`)에 이미 있었다 → "이번에 새로 만든 결함"은 아니다. **그러나** 같은 변경이 그 줄을 편집한 이상 "손대지 않았다"는 근거는 약하다. `TIER_UNKNOWN`을 import하는 한 줄 수정이 가능하므로 부채로 미루는 것보다 지금 고치는 편이 정본 2.4·2.8에 부합한다(치명도 낮음). |
| F4 | 부채 기록 | **불일치(수정해야 함)** | 처분 근거인 "이번 세션 이전 작업(범위 밖)"이 사실과 다르다. `git diff`는 `nextAfter(...)` 단정을 `stepForward(...)`로 **이번 미커밋 변경에서 교체**했음을 보여준다(`candidates.test.ts:143-148`). 즉 "대체된 함수의 시험이 대상만 갈아 끼워 남은" 3절 질문 2의 결과가 현재 리뷰 대상 상태다. 게다가 `candidates.test.ts`는 과제 범위에 명시된 `*.test.ts`다. → 아래 NF1 |
| mut-2 | 부채 기록 | **부분 동의** | `settings.test.ts:39`가 `resolveSettings({})` 기대값으로 `DEFAULT_SETTINGS`를, `:40`이 `DEFAULT_SETTINGS.cooldownMs === DEFAULT_COOLDOWN_MS`를 쓴다(생산 상수끼리 비교 → 둘 다 틀리면 놓침). 다만 `:41`이 `excludedOrigins`를 literal로 앵커한다. `settings.test.ts`도 범위 파일이므로 "범위 밖"은 약한 근거다. 치명도 낮음 → 부채 유지 가능하나 NF5로 묶어 기록 |
| mut-3 | 부채 기록 | **부분 동의** | `chain.test.ts:293-297` `CHAINS.length === 2`·`CODING_CHAIN.aliases` 단정은 내부 구성 고정(2.9). `chain.test.ts`도 범위 파일이라 "범위 밖"은 약하다. 생성 결과로 검증하는 편이 낫다 → NF5 |

**결론(2): 근거 있는 기각(F14)은 타당하다. 부채 기록 중 F4는 근거가 사실과 어긋나 수정 대상이며,
F7·mut-2·mut-3은 "범위 밖" 근거가 약하지만 치명도는 낮다.**

---

## 3. 처음부터 읽어 찾은 새 위반 (3절 세 질문 + 2.9 체크리스트)

아래는 처분표와 무관하게 현재 코드를 처음부터 읽어 찾은 것이다. 대역(`test-support.ts`)도 2.9의
"대역이 결함을 대신 처리하거나 필요한 경로를 우회하지 않는지" 기준으로 함께 판정했다.

### NF1. `nextAfter`의 시험이 `stepForward`로 갈아 끼워져 cooldown 시험과 중복 — **수정**
- 정본: **2.9**(같은 사실의 반복 단정), **3-2**(대체된 것이 지워지지 않고 남음)
- 위치: `extensions/aaii-router/candidates.test.ts:132-149`("steps past the model that failed",
  `stepForward` 호출) vs `extensions/aaii-router/cooldown.test.ts:121-131`("steps past a cooling candidate…")
- 효과 근거: `stepForward`는 `{ label }`에 제네릭이고 책임 소유는 `cooldown.ts`다. candidates 시험은
  "마지막→undefined, 미지 라벨→처음, undefined→처음"을 cooldown 시험과 동일하게 다시 단정하며,
  그 대상은 이번 변경에서 삭제된 `nextAfter`의 단정을 그대로 물려받았다(`git diff` 확인). 후보 선택에
  특화된 관측(예: `supportsImages`/`tier`와의 상호작용)은 하나도 없다.
- 실패 시나리오: `stepForward`의 "미지 라벨은 처음으로" 규칙을 바꾸면 두 파일을 함께 고쳐야 하고,
  candidates 쪽 사본은 보호하는 경계가 없어 다음 담당이 이를 원래 설계로 오인한다(Lava Flow).
- 권고 처분: **수정** — candidates의 `stepForward` 단정을 삭제한다. 후보 통합 관측이 필요하면
  `route()` 수준(index.test.ts처럼 다음 후보를 관측)으로 대체한다. 처분표의 "부채(범위 밖)"와 불일치.

### NF2. 도달 불가한 "설정 목록 중복 라벨" 입력을 고정 — **수정(경미) 또는 부채(근거 재기술)**
- 정본: **2.7**(구조상 발생 불가 상태를 시험으로 고정), **2.9**(과잉 명세 시험)
- 위치: `extensions/aaii-router/fallback-editor.test.ts:26-38`(`pinnedModels: ["p/c","gone/model","p/a","p/c","gone/model"]`,
  `excludedModels` 중복 포함) — 처분표 F8이 "설정 목록의 중복 라벨은 실제로 도달 가능"이라며 남긴 부분
- 효과 근거: `Settings`에 중복 라벨이 들어오는 경로가 없다. `editSetting`(`settings.ts:250`)은 `parseList`가
  중복을 제거(`:197-200`)하고, `parseSettings`는 배열을 `join(", ")` 후 `editSetting`에 위임(`:293-300`),
  `resolveSettings`의 env 경로도 `editSetting`(`:390`)이며, `editorSettings`(`fallback-editor.ts:138-145`)는
  라벨 집합 기반이라 중복을 만들지 않는다. 즉 이 입력은 시스템이 생산할 수 없다.
- 실패 시나리오: 다음 담당이 "Settings에 중복 라벨이 올 수 있다"고 오인해 방어 코드·시험을 추가한다.
  (시험 자체의 `nested === initial` 안정성 단정은 실제 계약이므로 잔여 검출력은 유지해도 된다.)
- 권고 처분: **수정(경미)** — 중복 라벨 입력 부분만 제거하고 중첩 `editorSettings` 안정성 단정은 남긴다.
  부채로 남기려면 "설정 목록 중복 라벨은 도달 가능"이라는 근거를 실제 경로로 제시해야 한다.

### NF3. `tier >= 99`와 `TIER_UNKNOWN`의 이중 정의(수정된 줄) — **수정 또는 명시적 부채**
- 정본: **2.4**(Magic Number 금지·단일 출처)
- 위치: `extensions/aaii-router/index.ts:307`(`candidate.tier >= 99`) vs `candidates.ts:170`(`=== TIER_UNKNOWN`)
  및 `extensions/coding-fallback/providers.ts:28`(`TIER_UNKNOWN = 99`)
- 효과 근거: 같은 "tier 99 = 미분류" 지식이 상수와 하드코딩 `99`로 두 번 적혀 있다(F7과 동일 사안).
  이번 변경이 해당 줄을 `const tier = …`로 편집했으므로 지금 함께 고치는 비용이 거의 없다.
- 실패 시나리오: `TIER_UNKNOWN` 값이 바뀌면 보고서는 `tier 99`를 찍는데 `unclassifiedCandidates`는
  미분류를 못 잡아 같은 실행에서 집계가 어긋난다.
- 권고 처분: **수정** — `TIER_UNKNOWN`을 import해 `candidate.tier >= TIER_UNKNOWN`(또는 `=== TIER_UNKNOWN`)으로.
  미룰 경우 "이번 변경에서 편집한 줄"임을 처분 기록에 남긴다.

### NF4. 미리보기의 "다음 요청이 갈 순서" 주장이 실제 사용 경로(`orderForRequest`)와 다름 — **수정(문구) 또는 부채**
- 정본: **2.4**(같은 사실의 단일 출처), **3-1**(기존 책임 자리를 고치지 않고 같은 일을 하는 길을 하나 더 만드는가)
- 위치: `extensions/aaii-router/fallback-editor.ts:147-158`(`pipelinePreview`), 표시 `fallback-tui.ts:235-237`,
  주장 문구 `fallback-tui.ts:235-236`·`README.md:231`, 실제 라우팅 `index.ts:540-543`
  (`orderForRequest(applyChainSettings(...), settings.preferVision && containsImage(...))`)
- 효과 근거: F1 수정으로 핀·제외 규칙은 `applyChainSettings` 하나로 통일됐지만, 라우팅의 실제 순서는
  여기에 `orderForRequest`(이미지 요청 시 시각 지원 후보 선두)를 한 단계 더 적용한다. 미리보기는 그
  단계를 적용하지 않으면서 "the order the next request would take"라고 주장한다. 즉 "요청 순서"를
  계산하는 두 번째 경로가 부분적으로 남아 있다.
- 실패 시나리오: 이미지가 있는 요청에서 운영자가 미리보기를 믿고 순서를 판단했는데 실제 라우팅은
  시각 지원 모델을 앞세운다. 편집기는 요청을 모르므로 미리보기가 틀린 것이 아니라 **문구가 과장**이다.
- 권고 처분: **수정(문구)** — "exclusions already skipped, before the per-request image adjustment"처럼
  범위를 정확히 하거나, 미리보기를 "체인 설정이 만든 순서"로 한정한다. 동작 변경이 필요 없다면 부채로
  기록하되 문구 과장은 남기지 않는다.

### NF5. 기대값을 제품 상수에서 가져오는 시험들 — **부채(일부 수정)**
- 정본: **2.9**(기대값이 구현에서 복사되지 않았는지)
- 위치: `settings.test.ts:39`(`resolveSettings({})` 기대 = `DEFAULT_SETTINGS`), `:274`(`SETTINGS.map(...)`),
  `:295`(`applied: SETTINGS.map(d => d.key)`), `chain.test.ts:294-296`(`CHAINS.length === 2`·내부 aliases),
  `cooldown.test.ts:78-83`(`DEFAULT_COOLDOWN_MS`를 입력·만료 기대에 함께 사용)
- 효과 근거: 생산 상수와 기대값이 같은 출처면 그 상수가 틀려도 시험이 통과한다(mutation-check가 지적한
  mut-2/mut-3과 같은 계열). 다만 `settings.test.ts:41`(origins literal), `:295`의 파일 왕복은 실제 계약을
  literal로 앵커하므로 결함 검출력이 완전히 비어 있진 않다.
- 실패 시나리오: `DEFAULT_COOLDOWN_MS`나 기본 origins가 실수로 바뀌어도 게이트가 통과한다.
- 권고 처분: **부채(우선순위 낮음)** — 문서화된 기본값·체인 개수는 독립 literal 또는 생성 결과로
  확인하도록 점진 이관. F4/NF1처럼 중복이 아니라 "기대값 출처" 문제이므로 즉시 실패로 보진 않는다.

### NF6. `setTimeout(10)`으로 rejected promise를 기다리는 시험 — **수정(경미)**
- 정본: **2.9**(시험마다 어떤 관측으로 위반을 잡는지)
- 위치: `extensions/aaii-router/fallback-tui.test.ts:343`·`:352`
- 효과 근거: onSave 실패/재시도 시험이 고정 10ms 대기에 의존한다. 관측(메시지·draft 보존·재시도)은
  계약이지만 동기화 수단이 시간이다. 부하가 큰 CI에서 간헐 실패할 수 있다.
- 실패 시나리오: 느린 머신에서 10ms 안에 promise가 안 풀리면 "editor must not resolve on save failure"
  단정이 타이밍 때문에 흔들린다(거짓 양성/음성).
- 권고 처분: **수정(경미)** — rejected promise를 직접 `await`하거나 디퍼드(`release`처럼)로 동기화한다.

### NF7. 폭 제한 로직이 `draw`와 `pipelinePreview` 두 곳에 있음 — **부채(경미)**
- 정본: **2.4**(같은 계산의 복사)
- 위치: `fallback-tui.ts:86`(`draw`의 `slice(0, room-1)+"…"`) vs `fallback-editor.ts:154-158`
- 효과 근거: "폭에 맞춰 자르고 말줄임표" 규칙이 두 곳에 있다. `pipelinePreview`가 이미 폭을 자르고,
  `draw`가 다시 자르므로 렌더에서는 이중이지만 무해하다. 순수 편집기 시험이 폭 계약을 직접 검증할 수
  있다는 장점도 있다.
- 실패 시나리오: 말줄임표/경계 규칙(폭 0·1 처리)을 한쪽만 바꾸면 미리보기와 행 렌더의 잘림이 달라진다.
- 권고 처분: **부채** — 실제 소비자·검출력이 있으므로 즉시 삭제 대상은 아니다.

### 3.1 test-support.ts 판정 (대역) — **위반 아님**
- `test-support.ts:39-51` `writeSdkStubs`는 `@earendil-works/pi-tui`·`pi-coding-agent`를 임시
  `node_modules`에 스텁한다. 2.9 체크리스트 관점: (a) 대역이 결함을 대신 처리하지 않는다 —
  `dispatchKey`/`reduceEditor`/`onSave`/실제 파일 저장은 실제 코드가 돈다. (b) 필요한 경로를 우회하지
  않는다 — 컴포넌트가 받는 `data`를 실제 `handleInput`에 주입한다. (c) 기대값은 시험의 literal
  (`DOWN`/`UP`/`ENTER`/`ESC`)이다. (d) `writeSdkStubs` 한 곳을 `fallback-tui.test.ts`와 `index.test.ts`가
  공유한다(중복 없음). 3절 "정당한 경우: 실제 시스템 경계에 두는 adapter"에 해당한다.
- 남은 검증 경계(정확히 기록할 것): 스텁의 `matchesKey`(`test-support.ts:12-24`)는 SDK 프로토콜 해석을
  흉내 내지 않으므로 **SDK의 실제 키 파싱(legacy 시퀀스·Kitty, `k` vs `K` 대소문자 구분)**은 시험되지
  않는다. `fallback-tui.ts:131-142`는 `matchesKey(data,"k")`를 `matchesKey(data,"shift+k")`보다 먼저
  검사하므로, 만약 SDK가 `"K"`를 `"k"`와 동일시하면 `K`가 reorder가 아니라 커서 이동으로 해석될 수 있다.
  이는 SDK 계약 문제이고 README:342-346이 "SDK가 맡는다"고 명시하므로 **결함으로 단정하지 않되**, 남은
  실물 검증 경계로 처분 기록에 남긴다(2.9 "남은 검증 경계를 처분 기록에 적는다").
- `as unknown as Theme`(`fallback-tui.test.ts:66`)·`as unknown as ExtensionCommandContext`
  (`index.test.ts:87`)는 외부 경계 대역의 형 맞춤이므로 위반 아님(처분표 2차 확인과 동일 판정에 동의).

### 3.2 고려했으나 위반 아님으로 판정한 것
- **`orderedRows`가 제외 행을 끝에 다시 붙임**(`fallback-editor.ts:55-56`): 라우팅은 제외 행을 *제거*하고,
  편집기는 *표시*를 위해 마지막에 둔다. 같은 "순서"가 아니라 다른 소비자(체인 vs 목록 표시)이므로
  3-1의 "같은 일을 하는 길"이 아니다. 순서 규칙 자체는 `applyChainSettings` 하나다.
- **`openSettings`/`openFallbackEditor`/`set`의 env 경고 3곳**: 대상 범위(전체 설정 vs 체인 키 vs 단일 키)가
  다르고 각각 다른 문자열/조건을 쓴다. 같은 일의 중복이 아니다.
- **`index.test.ts:17-32`가 실제 소스를 임시 디렉터리로 복사해 import**: 복사본은 실제 모듈이고
  SDK만 대역이다(외부 경계 이격 목적). 모듈 목록(`:24`)을 새 모듈 추가 시 함께 갱신해야 하는 결합은
  있으나 위반은 아니다.
- **`README.md:342-346`의 "custom escape buffering을 넣지 않았다" 문장**: 판·세션 이력이 아니라
  다음 담당이 버퍼를 다시 넣지 않게 하는 결정 기록(Lava Flow 방지)으로 읽힌다. 유지 가능.

---

## 4. 2.10 완료 정의 — 네 단계 판정

1. **소스·import·빌드 성공 — 충족.** 별도 빌드 스크립트가 없고 이 저장소의 "빌드"는 Node 타입
   스트리핑 import다. 두 글롭의 모든 모듈을 import하는 시험 191건이 통과(pass 191, fail 0, skip 0).
2. **대역 통합 — 충족.** 대역이 실제 외부 경계에만 있다 — SDK 스텁(`test-support.ts`), 테마
   (`fallback-tui.test.ts:63-66`), `ctx.ui`/`ctx.modelRegistry`(`index.test.ts:69-87`), 임시 디렉터리 파일 I/O.
   `index.test.ts`는 실제 커맨드 핸들러·실제 `FallbackEditor`·실제 `saveSettings`/`loadSettings`를 통과하고
   다음 `route()`가 고른 후보를 관측한다. 순수 로직은 실제 함수로 돈다.
3. **사용 가능한 실물 증거 — 미충족.** 실제 Pi 터미널에서 `/aaii-router fallback`을 열어 저장한
   세션 로그·스크린샷 등 실물 증거가 없다. `README.md:348-351`도 "end-to-end 경로는 시험하지 않는다"고
   명시한다. SDK 실제 키 파싱(위 3.1의 남은 경계)은 실물에서만 확인된다.
4. **실물 준비 완료 — 미충족.** 3번 증거가 없고, 위 NF1·NF3·NF4의 정리(및 부채 기록 확정)가 남아 있다.
   기능 핵심(F1·F2·F3·F11)은 수정·검증됐으므로 "위험한 미해결 결함"은 아니지만, 정본 2.9/2.4가 요구하는
   정리 대상이 남아 있어 "실물에서 곧바로 신뢰할 수 있다"고는 말할 수 없다.

---

## 5. 처분 요약

- **resolved**: F1, F2+C5, F3+C2, F5, F6+C4, F8(`??`·중복 후보), F9, F10+C1, F11+M20–M22, F12,
  F13+C3, M02, M29+M34, mut-1, mut-4, B2-1, B2-2, B3 — 모두 현재 코드·시험에서 확인.
- **근거 있는 기각(동의)**: F14, `as unknown as Theme/ExtensionCommandContext`.
- **수정 권고(새 지적)**: NF1(시험 중복, F4 재분류), NF2(도달 불가 입력), NF3(`99` 이중 정의),
  NF4(미리보기 문구), NF6(타이밍 시험).
- **부채(근거 재기술 필요)**: NF5, NF7, mut-2, mut-3 — "범위 밖" 근거가 약하므로 처분 기록에
  파일이 범위임을 인정하고 재분류 시점을 적는다.
- **남은 검증 경계**: SDK 실제 키 파싱(Kitty/legacy·대소문자), 실제 Pi TUI 세션.

VERDICT: fix-first
