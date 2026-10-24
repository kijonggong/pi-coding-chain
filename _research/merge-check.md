# 병합 독립 확인 — `fcafd2e`

- 대상: `port/aaii-fallback-editor`의 병합 커밋 `fcafd2e` (부모 `3a507a6`, `2fed64e`, 기준 `111dfcc`)
- 기준: `engineering-standard` 스킬을 불러왔고 `docs/engineering-standard.md` 전문을 읽었다.
- 시작 상태: 작업 트리는 깨끗했다. 제품 파일은 고치지 않고 이 보고서만 추가한다.

## 보존·통합 확인

| main 커밋 | 병합 결과에서 확인한 내용 |
|---|---|
| `e18713d` | `WORKLOG.md`가 `3a507a6`와 동일하게 남아 있다. |
| `40b848b` | `coding-fallback/picker.ts:101-111`에서 `Input.render`와 `SelectList.render`를 모두 펼쳐 한 줄씩 그린다. 해당 시험을 포함한 전체 시험이 통과했다. |
| `e67472e` | `coding-fallback/catalog.ts:28-39,133-170`의 router 식별과 `index.ts:183-187`의 listing/fallback별 router 전달이 남아 있다. router 이름 시험들이 통과했다. |
| `912917f` | `coding-fallback/chain.ts:530-563`이 멤버 없는 한 체인은 건드리지 않고 걸러 낸다. 어느 체인에도 속하지 않는 설정만 거부하는 계약과 시험도 남아 있다. ExpLabs의 `deepseek-v4.1-flash-uncensored`, `muse-spark-open` 등록도 남아 있다. |
| `65042e9` | `aaii-scores.json:11-24,210-216`의 점수·alias·근거와 `fetch-scores.mjs:44-52`의 두 refresh target이 모두 남아 있다. |
| `3a507a6` | `aaii-router/settings.ts:121-127,283-290`과 `candidates.ts:68-105`의 provider별 exact allowlist가 남아 있고, `index.ts:257-261`이 실제 후보 구성에 전달한다. 기존 `models` 파일은 allowlist로 읽힌다. |

`models`는 `allowedModels`·`PI_AAII_ROUTER_ALLOW_MODELS`, `pinned`는 `pinnedModels`·`PI_AAII_ROUTER_PINNED`, `excluded`는 `excludedModels`·`PI_AAII_ROUTER_EXCLUDE_MODELS`에 각각 연결된다. 직렬화와 프로젝트 키 제한도 같은 대응을 따른다. 허용 목록으로 후보를 만든 뒤 `applyChainSettings`에서 excluded를 먼저 빼고 pinned를 앞세우므로 세 설정의 책임은 구분된다.

추가 무기록 Node probe에서 allowlist `p/a,p/b`, pins `p/c,p/b`, exclusions `p/a`를 함께 적용한 독립 기대값은 `["p/b","q/q"]`였고 실제 결과도 같았다. `models` 변경은 `routingChanged`가 감지했고, 기존 파일 `{ "models": ["p/a","p/b"] }`는 allowed로 읽히고 excluded는 빈 목록으로 유지됐다.

ExpLabs는 실제로 5개, DashScope는 7개다. `EXPLABS.baseUrl === EXPLABS_BASE_URL`이고 main이 추가한 두 모델을 포함해 `glm-5.3-uncensored`, `deepseek-v4.1-flash`, `deepseek-v4.1-flash-uncensored`, `muse-spark-open`, `qwen3.8-flash-next-uncensored`가 모두 등록되어 있다. ExpLabs endpoint 중복 정의나 별도 parser는 발견하지 못했다.

## 지적

| ID | 정본 절 | 위치 | 요지 | 권하는 처분 |
|---|---|---|---|---|
| MC-01 | 2.4 | `extensions/aaii-router/index.ts:447-455`, `extensions/aaii-router/README.md:275-281` | fallback 편집기의 비-TUI 대체 명령이 per-model exclusion을 안내하는 자리인데 두 곳 모두 `set models`를 가르킨다. 병합 후 `models`는 허용 목록이므로 이 명령은 해당 모델을 제외하는 대신 그 provider가 나열한 모델만 제공하도록 설정을 바꾼다. | 두 예시를 `set excluded <provider/id,...>` / `set excluded dashscope/glm-5`로 고쳐 코드·README·실제 키 의미를 맞춘다. |
| MC-02 | 2.4, 2.10 | `extensions/aaii-router/index.ts:451-456` | 같은 비-TUI 분기가 모듈에 정의되거나 import되지 않은 `notify(...)`를 호출한다. 정상적인 Node 실행에서는 안내 대신 `ReferenceError`가 나며, 현재 247개 시험은 이 공개 명령 경로를 지나지 않는다. | 새 helper를 만들지 말고 같은 파일의 다른 경로처럼 `ctx.ui?.notify?.(...)`를 직접 호출한다. 비-TUI `fallback`이 throw 없이 warning을 내는 공개 계약 시험을 추가한다. |
| MC-03 | 2.3, 2.5, 2.9 | `extensions/quota-providers/catalog.ts:24-26,63-72,95-98`, `catalog.test.ts:15,69-83`, `extensions/quota-providers/README.md:81-103` | DashScope를 curated 7개로 줄인 결과 `QWEN35_DENSE`와 `OUTPUT_SMALL`은 정의만 남았다. 제거된 `kimi-k3`·`kimi-k2.7-code`를 전제로 하는 `MAX_OUTPUT_CAVEAT`와 설명도 남았고, 실제 모델 소비자가 아니라 그 문자엘만 검사하는 단정이 이를 유지한다. | 두 미사용 상수와 caveat export·해당 문서·문자열 단정을 제거한다. 단, 모든 현재 모델의 `maxTokens < contextWindow`를 검사하는 실제 계약 시험은 유지한다. |
| MC-04 | 2.4 | `extensions/aaii-router/README.md:69`, `extensions/quota-providers/README.md:86-88` | 실제 카탈로그는 7+5인데 aaii-router 표는 29+2라고 적고, quota-providers는 5개 ExpLabs 항목을 두고 “Both ExpLabs entries”라고 적는다. 병합한 카탈로그와 문서가 서로 다르다. | aaii-router 쪽 중복 수치는 빼고 quota-providers README를 단일 설명으로 참조하게 한다. “Both”는 “All five” 또는 “Every ExpLabs entry”로 정정한다. |

## 실행 증거와 남은 경계

허용된 명령을 그대로 실행했다.

```powershell
$env:PI_OFFLINE='1'; $env:PI_CODING_FALLBACK_FREE_REFRESH='off'; node --test extensions/*/*.test.ts
```

결과는 **247 pass, 0 fail, 0 skipped**다. 시험 통과와 별개로 위 공개 경로·문서·잔여 코드 지적이 남는다. 실제 Pi 세션, 네트워크·유료 호출, 작업 트리를 바꾸는 mutation check는 수행하지 않았다.

VERDICT: findings remain