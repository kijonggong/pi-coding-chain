# 독립 코드 리뷰 — aaii-router fallback 체인 편집기와 coding-fallback 시험 이식성

판정 기준: `docs/engineering-standard.md` (이하 "정본"). 모든 지적에 정본 절 번호(2.1–2.11, 3, 4)를 근거로 적는다.
리뷰 방식: 읽기 전용. 소스·시험·문서를 수정하지 않았고 커밋하지 않았다. 작성한 파일은 이 보고서 하나뿐이다.
검토 범위: 이번 세션의 미커밋 변경 —
 A. `extensions/aaii-router/`의 `chain-order.ts`, `fallback-editor.ts`, `fallback-tui.ts`, 각 `*.test.ts`, `settings.ts`/`settings.test.ts`의 pinned/models 추가분, `fallback` 서브커맨드와 chain epoch·`applyChainSettings` 호출 지점, `README.md` 편집기 절.
 B. `extensions/coding-fallback/chain.test.ts`, `free-models.test.ts`의 비의존(hermetic) 시험 변경.
 그 밖의 변경은 사용 경로에 닿는 부분(`candidates.ts`/`candidates.test.ts`, `route()` 흐름)만 보았다.

> 범위 정정(코디네이터): Iron Laws(2.10-1)와 MATLAB 관련 항목은 판정에서 제외한다. 2.10 완료 정의는 다음 네 단계만으로 판정한다 — 소스·import·빌드 / 대역 통합 / 사용 가능한 실물 증거 / 실물 준비 완료.

## 0. 시험 실행 결과

```
node --test extensions/aaii-router/*.test.ts extensions/coding-fallback/*.test.ts
```

- tests 182 / pass 180 / fail 0 / skipped 2 / cancelled 0 / todo 0 (duration 1.0s)
- skip된 2건은 정확히 두 개의 opt-in 라이브 시험이다: `chain.test.ts` "…in the live config", `free-models.test.ts` "the live config accepts a generated group…" — 둘 다 `PI_CODING_FALLBACK_LIVE_TESTS=1`일 때만 돈다. 즉 이번 B 변경으로 기본 게이트에서 라이브 `~/.pi/agent/litellm_config.yaml` 의존이 사라졌다(2.7 외부 경계 처리, 2.9 skip 사용 목적은 "통과 가리기"가 아니라 기계 종속 자료 격리).

양호한 점(기준 충족): 
- `candidates.ts`의 `nextAfter`/`indexOfLabel`를 삭제하고 `cooldown.ts`의 `stepForward`로 일원화했다 — 2.3 "대체하면 제거" 충족.
- `fallback-editor.ts`(순수 초안)와 `fallback-tui.ts`(그리기·입력)의 분리는 2.6 관심사 분리의 모범 사례다.
- 시험의 기대값은 대부분 리터럴이고, 대역은 실제 외부 경계(테마, `ctx.ui`, 파일)에만 있다.

---

## 1. 지적 목록

### F1. 순서 결정 로직이 라우팅과 편집기에 이중 구현됨 — 2.4, 3-1
- 위치: `extensions/aaii-router/chain-order.ts:5-20` (`applyChainSettings`) vs `extensions/aaii-router/fallback-editor.ts:37-43` (`orderedRows`)와 `:133-141` (`pipelinePreview`).
- 위반 이유(효과 기준): "핀 먼저(설정 순서), 나머지는 점수 순서, 제외는 뒤"라는 같은 순서 지식이 두 곳에 있다. `pipelinePreview`는 코드 주석(`fallback-tui.ts:262-263`, `README.md:231`)과 문서에서 "다음 요청이 갈 순서"라고 주장하지만, 실제 라우팅이 부르는 `applyChainSettings`가 아니라 편집기 내부 정렬로 계산된다. 3절 질문 1("기존 책임 자리를 고치지 않고 같은 일을 하는 길을 하나 더 만드는가")에 **예**.
- 실패/유지보수 시나리오: 핀/제외 의미가 바뀌어 `applyChainSettings`만 고치면(예: "핀이 제외보다 우선한다") 편집기의 미리보기는 다음 요청의 실제 순서와 어긋난 채 남는다. 운영자가 미리보기를 믿고 `s`를 눌렀는데 체인이 다르게 도는 조용한 불일치다.
- 처분: **수정**. 미리보기를 `applyChainSettings(candidates, editorSettings(state, settings))` 결과에서 도출하거나, 순서 규칙을 한 함수로 추출해 라우팅과 편집기가 그 하나를 부르게 한다.

### F2. 터미널 바이트→키 매핑이 순수 모듈에 있고 시퀀스 목록이 이중화됨 — 2.6, 2.4, 3-1
- 위치: `extensions/aaii-router/fallback-editor.ts:144-158` (`keyFor`의 `"\x1b[A"` 등) vs `extensions/aaii-router/fallback-tui.ts:63-70` (`ESCAPE_SEQUENCES`), 그리고 그것을 쓰는 버퍼링 `fallback-tui.ts:133-173`.
- 위반 이유(효과 기준): 이스케이프 시퀀스 집합이라는 같은 지식이 두 파일에 따로 적혀 있다. 순수 편집기 모듈이 터미널 인코딩(입출력 경계 지식)을 들고 있고(2.6), 그 결과 집합을 TUI가 다시 적는다(2.4). 3절 질문 1에 **예**.
- 실패/유지보수 시나리오: 새 시퀀스(예: Home=`\x1b[H`)를 `keyFor`에 추가하고 `ESCAPE_SEQUENCES`에는 빠뜨리면, 그 키가 청크로 도착할 때 `fallback-tui.ts:160-170`의 접두 검사에서 걸리지 않아 `flushEscape`가 `\x1b`를 cancel로 디스패치해 편집기가 닫힌다.
- 처분: **수정**. 바이트 해석은 셸(`fallback-tui.ts`)로 옮기고, `fallback-editor.ts`는 `EditorKey`만 받는다. 시퀀스 표는 한 곳에 둔다.

### F3. chain epoch 무효화 규칙이 쓰기 경로마다 다르다 — 2.4, 2.7
- 위치: 설정 창 `extensions/aaii-router/index.ts:472-477`(`chainKeys` 4개: pinnedModels/excludedModels/excludedProviders/excludedOrigins), `set` 서브커맨드 `index.ts:675-677`(pinned/models만), 편집기 저장 `index.ts:537`(무조건), `reset` `index.ts:699`(무조건).
- 위반 이유(효과 기준): "체인이 바뀌었는가"라는 같은 판단을 세 경로가 각각 다르게 한다. `providers`/`origins`는 라우팅 후보 집합을 바꾸는데 `set` 경로는 epoch을 올리지 않고, 편집기는 변경이 없어도 저장만 하면 올린다. 2.4("같은 종류의 처리는 하나의 방식으로; 생산자·소비자를 함께 바꿔 일관성을 남긴다") 위반.
- 실패/유지보수 시나리오: `fallback-tui.test.ts:324-381`이 "체인 목록이 바뀔 때만 stickiness가 무효화된다"를 창 경로에서만 고정한다. 그래서 `/aaii-router set providers openrouter`와 창에서 같은 설정을 바꾸는 것의 세션 스티키니스 동작이 서로 다르고, 어떤 경로가 옳은지는 문서에 없다. 편집기에서 변경 없이 `s`만 눌러도 세션의 기억 후보가 초기화되는데, 이는 창 테스트가 "reset to existing defaults preserves stickiness"로 지키는 규칙과 정면으로 어긋난다.
- 처분: **수정**. "체인 키가 실제로 바뀌었는가" 프리디킷을 하나로 만들고 세 생산자가 그것을 쓰게 한다. 편집기도 변경이 있을 때만 epoch을 올린다.

### F4. 삭제된 `nextAfter`의 시험이 살아남아 cooldown 경계 시험과 중복됨 — 2.9, 2.3, 3-2
- 위치: `extensions/aaii-router/candidates.test.ts:132-149` ("steps past the model that failed", `stepForward` 호출) vs `extensions/aaii-router/cooldown.test.ts:121-131` ("steps past a cooling candidate…").
- 위반 이유(효과 기준): `stepForward`는 `{ label }`에 대해 제네릭이고 cooldown 소유다. candidates 시험은 "마지막 → undefined, 미지 라벨 → 처음, undefined → 처음"을 cooldown 시험과 똑같이 다시 단정한다(같은 사실의 반복, 2.9). 대체된 함수(`nextAfter`)의 시험은 함께 지워지지 않고 대상만 갈아 끼워 남았다 — 3절 질문 2("대체된 것이 지워지지 않고 남는가")에 **예**.
- 실패/유지보수 시나리오: `stepForward`의 "미지 라벨은 처음으로" 규칙을 바꾸면 같은 계약을 두 파일에서 고쳐야 하고, candidates 쪽 복사본은 후보 선택에 특화된 관측이 하나도 없어 보호하는 경계가 없다.
- 처분: **수정**. `candidates.test.ts`의 이 시험을 삭제한다(후보 관련 통합 관측이 필요하면 `route()` 수준 시험으로 대체).

### F5. 시험 이름이 리뷰 산출물 번호를 달고 있다 — 2.11, 2.9
- 위치: `extensions/aaii-router/fallback-tui.test.ts:260`("H7: …"), `:383`("Finding 2: …"), `:416`("Finding 3: …"), `:426`("Finding 5: …"), `:450`("Finding 1 (stickiness): …").
- 위반 이유(효과 기준): 시험 이름이 지키는 계약이 아니라 과거 리뷰 지적 번호를 가리킨다. 정본 2.11("판·세션 이력은 주석에 쓰지 않는다")과 2.9("시험은 공개 계약의 의미를 이름으로 드러낸다")의 취지에 어긋난다.
- 실패/유지보수 시나리오: 리뷰 기록이 사라지면 "Finding 5"가 무엇을 보호하는지 알 수 없어, 다음 담당이 실패 원인을 계약에서 찾지 못하고 번호에서 찾는다.
- 처분: **수정**. 계약을 설명하는 이름으로 바꾼다(예: "narrow viewports keep the save and cancel keys").

### F6. index/설정창/epoch 시험이 TUI 컴포넌트 시험 파일에 있다 — 2.1, 2.9
- 위치: `extensions/aaii-router/fallback-tui.test.ts:324-381`(설정 창·epoch), `:450-487`(`chooseTurnCandidate`).
- 위반 이유(효과 기준): `FallbackEditor` 컴포넌트의 시험 파일이 `index.ts`의 커맨드 핸들러와 라우터 상태(epoch)를 통째로 불러 검사한다. 한 모듈/시험 파일이 두 책임을 진다(2.1). 이 때문에 컴포넌트 시험이 라우터 전체에 결합된다.
- 실패/유지보수 시나리오: `index.ts`의 import나 초기화가 바뀌면 컴포넌트와 무관한 TUI 시험이 깨진다. 또 epoch 계약의 소유 위치가 불명확해 F3 같은 경로별 불일치가 생겨도 어디서 막아야 할지 알기 어렵다.
- 처분: **수정**(낮은 위험). `aaii-router/index.test.ts`(라우터/설정창/epoch)로 옮긴다.

### F7. "no tier" 판정이 매직 넘버로 이중화됨 — 2.4
- 위치: `extensions/aaii-router/index.ts:328` `candidate.tier >= 99 ? "no tier" : "tier " + candidate.tier` vs `extensions/coding-fallback/providers.ts:28` `TIER_UNKNOWN = 99`, `extensions/aaii-router/candidates.ts:169-170` `=== TIER_UNKNOWN`.
- 위반 이유(효과 기준): "tier 99 = 미분류"라는 같은 지식이 상수와 하드코딩된 `99`로 두 번 적혀 있다(2.4 Magic Number 금지, 단일 출처).
- 실패/유지보수 시나리오: `TIER_UNKNOWN` 값이 바뀌면 보고서는 `tier 99`를 찍는데 `unclassifiedCandidates`는 미분류를 못 잡아, 같은 실행에서 "tier 99" 모델이 "no quota tier" 집계에서 빠진다.
- 처분: **수정**(또는 부채 기록). `TIER_UNKNOWN`을 import하거나 `unclassifiedCandidates`를 재사용한다.

### F8. 도달 불가 입력을 가정한 시험과 죽은 방어 — 2.9, 2.7
- 위치: `extensions/aaii-router/fallback-editor.test.ts:26-39`(중복 라벨 후보 `[...candidates, candidates[0], candidates[2]]`), `extensions/aaii-router/fallback-editor.ts:70`(`draft[ORIGINAL_ORDER] ?? …` 폴백).
- 위반 이유(효과 기준): `eligibleModels`(`candidates.ts:86-96`)가 라벨로 중복을 제거하므로 `buildCandidates` 출력에 중복 라벨 후보는 생산될 수 없다(`candidates.ts:100-125`). 또 `EditorState`를 만드는 곳은 `initialEditorState` 하나이고 항상 `ORIGINAL_ORDER`를 심으므로 `reduceEditor`의 폴백 분기는 도달 불가다. 2.7("구조상 발생할 수 없는 상태에 검사·복구 분기를 추가하지 않는다")과 2.9("발생할 수 없는 상태를 시험으로 고정하지 않는다").
- 실패/유지보수 시나리오: 시험이 시스템이 만들 수 없는 입력의 동작을 계약처럼 고정하고, `??` 폴백은 어떤 경로로도 실행되지 않으면서 `ORIGINAL_ORDER` 숨은 필드를 "정상 설계"로 보이게 한다. F4와 같은 유형의 유지보수 부담이다.
- 처분: **부채 기록**(설정 목록의 중복 라벨 부분은 실제로 도달 가능하니 남기고, 중복 *후보* 입력 부분은 제거). 폴백 분기는 정리 대상 후보로 기록한다.

### F9. 호출 횟수를 고정하는 단정 — 2.9
- 위치: `extensions/aaii-router/fallback-tui.test.ts:321` `assert.equal(savingRenders, 1, …)`.
- 위반 이유(효과 기준): 2.9가 금지하는 "코드 모양/호출 횟수만 고정하는 단정". 같은 시험의 `attempts === 1`(중복 저장 방지)은 실제 계약이지만, 렌더 횟수는 계약이 아니다.
- 실패/유지보수 시나리오: 렌더를 모아서 한 번만 그리도록 리팩터링하면 계약 변화 없이 시험이 깨진다.
- 처분: **부채 기록**(`attempts === 1`은 유지). 산발적 렌더 요청이 실제로 필요한 계약이면 이유를 주석으로 남긴다.

### F10. opt-in 라이브 시험이 fixture 시험과 같은 불변식을 반복 — 2.9
- 위치: `extensions/coding-fallback/chain.test.ts:294-316`와 `:286-292`(둘 다 `assertOnlyGeneratedBlocksChanged`), `extensions/coding-fallback/free-models.test.ts:464-477`와 `:460-462`(둘 다 `assertGeneratedGroupAccepted`).
- 위반 이유(효과 기준): 같은 도우미로 같은 불변식을 fixture 입력과 라이브 입력에 두 번 검사한다(2.9 "같은 사실의 반복 단정"). 라이브 시험은 기본 게이트에서 skip되므로 검출력에 기여하지 않는다.
- 실패/유지보수 시나리오: 게이트는 fixture 시험 하나로 유지되고, 라이브 시험은 손볼 때마다 두 곳을 함께 고쳐야 하는 유지보수 비용이 된다. 다만 fixture가 실제 파일 모양을 대표하는지는 라이브로만 확인되므로, "진단용"으로 남기는 것은 근거 있는 예외가 될 수 있다.
- 처분: **부채 기록**(또는 근거 있는 유지). fixture 시험이 게이트임을 주석으로 명시하고, 라이브 시험은 진단 전용임을 분명히 한다. 제거해도 검출력 손실은 없다.

### F11. `fallback` 커맨드 → 편집기 → 저장 배선이 어떤 시험에도 걸리지 않음 — 2.9
- 위치: `extensions/aaii-router/index.ts:492-550`(`openFallbackEditor`), 특히 `onSave` → `saveSettings`(`:526-528`)와 저장 후 `bumpChainEpoch()`/`forget()`(`:537-538`).
- 위반 이유(효과 기준): 실제 사용 경로(서브커맨드 `fallback` → `ctx.ui.custom` → 편집기 → 파일 쓰기 → epoch/cache)를 끝까지 잇는 시험이 없다. `fallback-tui.test.ts`는 컴포넌트를 자체 하니스로 직접 구동하고, 설정창 시험은 `settings` 경로만 돈다. 2.9("실제 생산자·소비자를 잇는지").
- 실패/유지보수 시나리오: `onSave`를 빠뜨리거나 `forget()`을 지워도 어떤 시험도 실패하지 않는데, 그러면 저장 후 다음 요청이 옛 체인을 계속 쓰는 조용한 버그가 된다.
- 처분: **수정**. 설정창 시험처럼 `ctx.ui.custom`을 스텁으로 대체해 `fallback` 핸들러를 돌리고 파일 내용·epoch을 단정하는 통합 시험을 추가한다(대역은 외부 TUI 경계에만 둔다).

### F12. 같은 오류 메시지와 guard가 두 곳에 있음 — 2.4(경미)
- 위치: `extensions/aaii-router/index.ts:571-576`(`route()`의 head 없음 throw) vs `extensions/aaii-router/index.ts:188-193`(`chooseTurnCandidate`의 동일 메시지 throw).
- 위반 이유(효과 기준): 같은 문구·같은 조건의 guard가 두 벌이다. `route()` 쪽은 continuation 경로 때문에 `head` 변수가 필요해 완전 중복은 아니지만, 메시지 문자열의 단일 출처가 없다.
- 실패/유지보수 시나리오: 문구를 한쪽만 고치면 같은 조건이 경로에 따라 다른 오류를 낸다.
- 처분: **부채 기록**(공용 상수/함수로 통합).

### F13. 소비자 없는 export — 2.5
- 위치: `extensions/aaii-router/settings.ts:27` `SETTING_KEYS`(런타임 값으로 쓰는 곳 없음, `SettingKey` 타입 유도에만 사용), `extensions/aaii-router/index.ts:167-169` `bumpChainEpoch`(내부 호출만 있고 외부 import 없음).
- 위반 이유(효과 기준): 2.5 YAGNI — 실제 소비자가 없는 심볼을 공개한다.
- 실패/유지보수 시나리오: 공개 API 표면이 이유 없이 커진다(경미).
- 처분: **부채 기록**(실제 소비자가 생길 때 export; 아니면 `bumpChainEpoch`는 비공개로).

### F14. 한 규칙을 세 계층에서 재검사 — 2.9(경미)
- 위치: `extensions/aaii-router/settings.test.ts:221-237` — 같은 라벨 정규식(`settings.ts:251`)을 `editSetting`, `parseSettings`, `resolveSettings` 세 경로로 반복 검증. 세 경로는 모두 `editSetting`에 위임한다(`settings.ts:300`, `:385`).
- 위반 이유(효과 기준): 하나의 규칙(라벨 형식)이 세 계층에서 재단정된다. 다만 편집·파일·환경은 서로 다른 신뢰 경계이므로, "위임이 끊기면 잡는다"는 목적이면 근거가 있다.
- 실패/유지보수 시나리오: 정규식을 바꾸면 세 경계의 기대가 함께 흔들리지만 검출력은 늘지 않는다.
- 처분: **근거 있는 유지 또는 부채 기록**. 유지하려면 "경계별 위임 보증"이 목적임을 시험에 적는다.

---

## 2. 2.9 체크리스트로 본 시험 (고장 주입 경계 / 리터럴 기대값 / 대역 우회 / 중복)

- `chain-order.test.ts`: 순수 함수 단위. 기대값 리터럴(`["c","a","b","d"]`), 대역 없음, 객체 동일성까지 단정(`:13`). 경계 적합. 중복 없음.
- `fallback-editor.test.ts`: 순수 reducer. 대부분 리터럴. 문제는 F8(도달 불가 중복 후보) 하나. 그 외 양호.
- `fallback-tui.test.ts`: 컴포넌트를 실제 바이트로 구동. 대역은 테마(장식) 하나로 실제 외부 경계다(`:31-34`) — 우회 아님. 다만 F5(이름), F6(소유), F9(호출 횟수), 그리고 설정창/epoch 시험이 이 파일에 섞인 점이 2.9 관점의 흠이다. 설정창 시험은 `ctx.ui`만 스텁하고 실제 핸들러·실제 임시 파일을 쓴다(`:324-381`) — 필요한 경로를 우회하지 않는다. 관측이 `currentChainEpoch()`라는 내부 카운터라는 점은 구현 결합에 가깝다(계약 관측은 "다음 턴이 새 head를 고른다"이다).
- `settings.test.ts`: 단위·파일 왕복. 기대값 리터럴, 임시 디렉터리 사용, 실제 `saveSettings`/`loadSettings` 경로. F14만 경미.
- `candidates.test.ts`: `orderForRequest`/`containsImage`는 리터럴로 양호. F4(중복) 하나.
- `chain.test.ts`/`free-models.test.ts`: fixture가 실제 compose 함수의 입력이라 생산자-소비자를 잇는다. 라이브 시험은 F10. 헬퍼 추출로 중복은 오히려 감소(양호).

---

## 3. 2.10 완료 정의 — 네 단계 판정 (범위 정정 반영)

1. **소스·import·빌드 성공 — 충족.** `package.json`에 scripts/tsconfig가 없어 별도 빌드가 없고, 이 저장소의 "빌드"는 Node 타입 스트리핑 import다. 두 글롭의 모든 모듈을 import하는 시험 182건이 통과했다(pass 180, fail 0).
2. **대역 통합 — 충족.** 대역이 실제 외부 경계(터미널 테마 `fallback-tui.test.ts:31-34`, `ctx.ui`/`ctx.modelRegistry` 스텁, 임시 디렉터리 파일 I/O)에만 있고, 순수 로직은 실제 함수로 돈다. 설정창 시험은 실제 커맨드 핸들러와 실제 `saveSettings`/`loadSettings`를 통과한다.
3. **사용 가능한 실물 증거 — 미충족.** 이번 작업에서 실제 Pi 터미널에서 `/aaii-router fallback`을 열어 저장한 세션 로그·스크린샷 등 실물 증거가 없다. `README.md:346-349`도 "aaii/fallback에 대한 end-to-end 경로는 시험하지 않는다"고 명시한다. 편집기·순서·cooldown은 순수 함수로 검증되지만, `route()`가 `applyChainSettings`+`orderForRequest`+`cooldown`을 한 흐름으로 엮는 부분은 실물로 확인되지 않았다.
4. **실물 준비 완료 — 미충족.** 3번 증거가 없고, 더해 F3(경로별 epoch 불일치)과 F11(`fallback` 커맨드 배선 미검증)이 남아 있어 "실물에서 곧바로 신뢰할 수 있다"고 말할 수 없다.

---

## 4. 처분 요약

- **수정(실물 전에)**: F1, F2, F3, F4, F5, F6, F11 (그리고 F7은 국소 수정 권장).
- **근거 있는 유지 / 부채 기록**: F8, F9, F10, F12, F13, F14.

핵심 위험은 사용자에게 보이는 조용한 불일치 두 가지다 — 편집기 미리보기가 실제 라우팅 순서와 어긋날 수 있다는 점(F1), 그리고 편집기 저장이 변경이 없어도 세션 스티키니스를 끊는다는 점(F3). 나머지는 중복·시험 위생 문제로 정본 2.3/2.9/3절이 요구하는 정리 대상이다.

VERDICT: fix-first
