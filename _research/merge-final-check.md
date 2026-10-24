# 최종 독립 확인 — `14921a3` (MC-01~04 처분 검증)

- 대상: `port/aaii-fallback-editor`의 커밋 `14921a3` 한 개(작업 트리는 깨끗하고 HEAD는 `f4da5c7`)
- 기준: `engineering-standard` 스킬을 불러왔고 `docs/engineering-standard.md` 전문을 읽었다. `_research/merge-check.md`(MC-01~04)를 읽었다.
- 독립성: 나는 이 수정에 참여하지 않은 새 세션이다.
- 실행 증거: `$env:PI_OFFLINE='1'; $env:PI_CODING_FALLBACK_FREE_REFRESH='off'; node --test extensions/*/*.test.ts` → **248 pass, 0 fail, 0 skipped**(커밋 메시지의 248과 일치; 병합 확인 당시 247 + 새 시험 1개).

## MC별 해결 여부

| ID | 판정 | 근거 |
|---|---|---|
| MC-01 | **해결** | 비-TUI 안내 문구가 `set excluded <provider/id,...>`로 바뀌었다(`extensions/aaii-router/index.ts:454`). README 예시도 `/aaii-router set excluded dashscope/glm-5`다(`extensions/aaii-router/README.md:280`). `settings.ts:28`의 `SETTING_KEYS`에 `excluded`가 실제 키로 있어 코드·문서·키 의미가 일치한다. `README.md:49`에 `set models`가 남지만 그것은 "Allowed models"(허용 목록) 절의 예시로, 병합 뒤 `models`의 실제 의미와 맞는 올바른 용례라 남아 있는 것이 타당하다. |
| MC-02 | **해결** | 존재하지 않는 `notify(...)` 호출이 같은 파일의 다른 경로들(`index.ts:396,399,406` 등)과 동일한 `ctx?.ui?.notify?.(...)` 직접 호출로 바뀌었다(`index.ts:452`). 새 helper는 만들지 않았고, 파일 안에 남는 `notify(` 호출도 없다. 공개 계약 시험이 추가됐다: rpc 모드에서 실제 `fallback` 명령을 돌려 warning 1개와 스크립트 가능 키 안내를 단정한다(`index.test.ts:200-208`). |
| MC-03 | **해결** | `QWEN35_DENSE`, `OUTPUT_SMALL`, `MAX_OUTPUT_CAVEAT`가 정의와 함께 지워졌고(`catalog.ts`에는 `QWEN35_LARGE`, `OUTPUT_LARGE`만 남는다), 시험에서 `MAX_OUTPUT_CAVEAT` import와 문자열 단정도 제거됐다(`catalog.test.ts:15,69-77`). 모든 항목의 `maxTokens < contextWindow`를 검사하는 실제 계약 시험은 유지됐다(`catalog.test.ts:69-76`). README의 "One deliberate deviation" 절은 일반 규칙 서술로 대체됐고(`README.md:94-97`), `catalog.ts:22-25` 머리말의 caveat 참조도 함께 지워졌다. 저장소 전체 grep에서 세 상수의 잔재는 없다. `coding-fallback/aaii-scores.json`과 `fetch-scores.mjs`의 kimi 항목은 카탈로그가 아니라 AAII 점수 스냅샷 데이터(다른 책임)라 잔재가 아니다. |
| MC-04 | **해결** | aaii-router README의 "29 + 2 models" 수치가 빠지고 단일 설명인 quota-providers README를 가리킨다(`README.md:69`). quota-providers README의 "Both ExpLabs entries"는 "Every ExpLabs entry"로 정정됐고(`README.md:86`), 실제 `EXPLABS.models`는 5개다(`catalog.ts:123-186`). |

## 새 시험의 계약 검증 (2.9)

`fallback outside the TUI warns and names the scriptable keys instead of throwing`(`index.test.ts:200-208`):

- **실제 경로를 지난다.** 하네스의 `ui` 대역은 호스트 TUI 경계만 갈아끼우고 실제 명령 핸들러와 실제 분기(`index.ts:450`)를 실행한다. `h.session.mode = "rpc"`는 공개 컨텍스트의 모드 값을 바꾸는 것이지 제품 코드의 우회가 아니다.
- **기대값이 계약의 독립 서술이다.** (1) throw 없이 끝난다(이전 결함은 `ReferenceError`였으므로 이 시험은 그 회귀에 실패한다), (2) warning 1개, (3) 안내가 `set pinned`·`set excluded` 스크립트 가능 키를 이름으로 알린다 — MC-01이 고친 키 이름이 기대값에 직접 들어 있어 `set models`로 되돌아가면 실패한다.
- **과검증이 아니다.** 단 하나의 시험이 하나의 공개 명령 경계를 확인하고, 같은 경계를 재검사하는 guard·재해시는 없다. 안내 문구의 리터럴 일부를 정규식으로 단정하지만 그 문구 자체가 운영자가 보는 계약의 내용이므로 구현 세부 묶임에 해당하지 않는다.
- `session: ctx as unknown as { mode: string }` 캐스트는 외부 경계(호스트 세션) 대역의 형 맞춤으로 정당하다.

## 새 정본 위반 검토 (3절, 2.7, 2.9, 2.3)

- **3절 덧대기**: 없음. 고친 책임 자리(비-TUI 분기)에서 직접 고쳤고, 감싸기·호환층·플래그·새 진입 경로를 더하지 않았다. 대체된 것(`notify` 호출 형태, 세 상수, caveat 문서·단정)은 같은 커밋에서 모두 지워졌다(2.3).
- **조용한 실패**: `ctx?.ui?.notify?.`의 옵셔널 체이닝은 UI 면이 없는 print 세션에서 알림 채널이 없을 때의 기존 파일 관례(`index.ts:396` 등)와 같고 MC-02 처분이 가리킨 형태라 새 위반이 아니다.
- **과검증**: 새 시험 1개가 위 계약 수준이며, 제거된 문자열 단정은 오히려 과검증을 덜었다.
- **죽은 코드·문서**: 위 grep으로 잔재 없음. 커밋 메시지는 더한 것·뺀 것과 시험 수를 함께 적어 2.11·4절 요구를 충족한다.
- **범위 규율(2.8)**: 커밋은 MC-01~04에 닿는 6개 파일로 한정돼 있다.

## 새 지적

없음. MC-01~04의 수정 처분이 모두 실제 코드·문서에서 확인됐고, 이 수정이 끌어들인 새 위반도 발견하지 못했다. 실제 Pi 세션(TUI·rpc 런타임)에서의 동작과 mutation check는 이 읽기 전용 확인의 범위 밖이다.

VERDICT: pass
