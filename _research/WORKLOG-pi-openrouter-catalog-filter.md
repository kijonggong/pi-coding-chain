# 작업 기록 (Work Log)

작성일: 2026-10-13
저장소: `D:\repository\pi-openrouter-catalog-filter` (GitHub: `kijonggong/pi-openrouter-catalog-filter`)
대상 환경: Pi 1.1.0, LiteLLM 프록시(`127.0.0.1:4000`), Windows / PowerShell 5.1

---

## 1. 현재 상태 요약

| 항목 | 상태 |
|---|---|
| 저장소 최신 커밋 | `ac07723` — push 완료, 전역 설치본도 동일 커밋 |
| 라이브 LiteLLM 설정 | **미변경** (22,516바이트, 원본 mtime 유지, 백업 파일 없음) |
| Pi `models.json` | **미변경** |
| 테스트 | 26/26 통과 (3개 테스트 파일) |
| AAII 순서 폴백 | LiteLLM 설정 생성기로 구현 완료 + Pi 가상 모델 라우터로 구현·**실제 동작 확인** |
| 미착수 | Pi에서 `litellm` 항목 삭제 (사용자 결정 대기), `sync` 적용 (승인 대기) |

---

## 2. 저장소 구성

```
extensions/
  openrouter-catalog-filter/   기존 확장 — OpenRouter 카탈로그 필터
  coding-fallback/             LiteLLM 설정 생성기 (이번 작업)
    chain.ts                   순수 생성기 — 파싱·정렬·블록 생성·스플라이스
    config.ts                  파일 I/O — 점검·백업·쓰기 (Pi SDK 미사용)
    providers.ts               quota 티어 표
    scores.ts                  AAII 점수 조회
    fetch-scores.mjs           HF 미러에서 점수 추출 (키 불필요)
    aaii-scores.json           점수 스냅샷 (19/25 확보)
    index.ts                   Pi 확장 진입점 — 명령·드리프트 알림
    chain.test.ts / config.test.ts
  aaii-router/                 Pi 가상 모델 라우터 (이번 작업)
    candidates.ts              순수 후보 선정·정렬·전진 로직
    index.ts                   `aaii/fallback` 가상 모델 등록
    candidates.test.ts
_research/                     조사 스크래치 (커밋 제외)
```

`package.json`의 `pi.extensions`에 3개 확장이 등록돼 있습니다.

---

## 3. 작업 연대기

### 3.1 OpenRouter 카탈로그 필터 (초기)

- Pi 0.85.1의 정적 카탈로그가 옛 `:free` 항목을 붙잡는 문제를 우회하는 확장으로 시작.
- Pi 1.0.2부터 번들 카탈로그에서 해당 항목이 빠지고 Pi 본체가 원격 카탈로그를 직접 overlay하게 되어 **원래 목적이 소멸**.
- 확장이 반환하는 모델 목록이 `models.json` 결과를 **교체**하기 때문에 사용자가 직접 넣은 모델 4개가 삭제되는 부작용을 발견·보고.
- 커밋 `9c86346`: stale 목록 제거 → `UNSERVED_OPENROUTER_MODELS` 추가.
- 커밋 `ee0dc27`: 제외 목록 → **허용 목록** 전환 (`:free`, `-alpha`, deepseek v4.1 flash, `auto`). 395 → 19개.
- 커밋 `b977ff5`: 서비스 종료 모델 6개를 하나의 목록으로 통합.

### 3.2 AAII 순서 폴백 (LiteLLM 설정 생성기)

사용자가 정한 정책:

```
자동 폴백 = AAII 점수 높은 순
같은 모델이면: 무료 → 하루 → 주간 → 월간 → Credit
```

- `chain.ts`: `model_list`를 읽어 `model_group_alias` + `fallbacks` 블록을 생성. 472줄 매트릭스를 자동 생성.
- `providers.ts`: 6개 호스트의 티어 표 (모두 출처 기록).
- `scores.ts` + `fetch-scores.mjs`: AAII 점수를 HF 미러에서 추출.
- `config.ts`: 점검·백업·쓰기. **점수 스냅샷이 비면 쓰기 거부**.
- 커밋 `ac07723`으로 push, `pi update --extensions`로 전역 설치.

### 3.3 Pi 가상 모델 라우터 (직접 사용)

사용자 요청: "litellm을 통해 쓰지 말고 직접 쓰는게 좋을 것 같다" + "이 라우터는 pi에서 삭제하고".

- Pi 1.1.0이 `pi.registerVirtualModel()`을 지원하고, `route()`가 `reason: "retry"`일 때 `request.failed`를 받아 **다른 모델로 전환**할 수 있음을 확인.
- `aaii-router` 확장 작성: `aaii/fallback` 가상 모델이 AAII 순서로 물리 모델을 고르고, 실패 시 다음 후보로 전진.
- LiteLLM 프록시 origin은 후보에서 제외(순환 방지).
- **삭제는 수행하지 않음** — 사용자가 답변하지 않아 되돌릴 수 없는 작업을 보류.

---

## 4. 데이터

### 4.1 AAII 점수 (2026-10-13 추출, 19/25 확보)

출처: Hugging Face `evaleval/EEE_datastore` (MIT, 키 불필요).
Artificial Analysis Intelligence Index v4.3.x — **출처 표기 필수**, 무료 티어는 재배포 금지.

| 모델 | 점수 | 모델 | 점수 |
|---|---:|---|---:|
| qwen3.8-max / -0902 | 45.4 | kimi-k3 | 43.6 |
| glm-5.2 | 42.1 | glm-5.3-flash | 41.8 |
| glm-5.1 | 41.0 | qwen3.8-flash-next | 39.8 |
| deepseek-v4.1-flash | 39.5 | qwen3.7-plus | 39.4 |
| qwen3.5-122b-a10b | 32.8 | qwen3.7-max | 29.5 |
| qwen3.6-27b | 29.0 | qwen3.6-max-preview | 28.4 |
| qwen3.6-plus | 27.0 | qwen3.5-27b | 26.9 |
| kimi-k2.7-code | 26.3 | qwen3.5-omni-plus | 20.4 |
| qwen3.5-35b-a3b | 19.3 | qwen3.5-397b-a17b | 19.1 |

**미확보 6개** (AAII에 항목 없음): `qwen3.8-flash-next-uncensored`, `qwen3.8-flash-next-iq3_s`,
`qwen3.5-flash`, `qwen3.5-plus`, `qwen3.6-flash`, `qwen3.7-flash`.
→ 스냅샷의 `aliases`에 형제 모델을 지정하면 순위에 편입됩니다 (미지정 상태).

### 4.2 공급자 quota 티어

| 티어 | 호스트 | 근거 |
|---|---|---|
| 무료 | `100.78.239.122` (자체 Strata) | 자체 호스팅 |
| 하루 | `127.0.0.1` (Cline 릴레이), `integrate.api.nvidia.com` | freeflow 문서 / 사용자 확인 |
| 주간 | `api.commandcode.ai` (DeepSeek 4.1 Flash 전용) | 사용자 확인 |
| 월간 | `api.experientiallabs.ai` (GLM-5.3 Flash 전용, 가끔 무료 코딩 모델) | 사용자 확인 |
| Credit | `dashscope-intl.aliyuncs.com` | 사용자 확인 |

### 4.3 도출된 순서 (라이브 설정 기준)

코딩 체인 head 변경: `code-1-...uncensored` → `code-10-qwen3.8-max`, 마지막 두 자리는 미채점.

DeepSeek 동일 모델 그룹(39.5)이 정책을 그대로 재현:

```
nvidia (daily) → cline (daily) → commandcode (weekly) → explabs (monthly)
```

---

## 5. 검증

### 통과

| 검증 | 방법 | 결과 |
|---|---|---|
| 순수 로직 | `node --test` | **26/26** |
| 설정 생성기 — 라이브 설정 재현 | 바이트 단위 비교 | 통과 (정렬 정책이 손 관리 파일과 일치) |
| Pi 로드 | `pi -e <dir> --list-models` | 오류 없음 |
| 가상 모델 등록 | `pi --list-models aaii` | `aaii/fallback` 표시 |
| **라우터 종단 동작** | `pi --mode json -p '...' --model aaii/fallback -e <dir>` | **성공** — `commandcode/Qwen/Qwen3.8-Max` 선택, `stopReason: stop` |
| 라이브 설정 무결성 | 크기·mtime·해시 | 미변경 |

종단 테스트 근거: 세션에 `pi.virtual-model-state` 엔트리가 `{provider: "aaii", modelId: "fallback", state: {label: "commandcode/Qwen/Qwen3.8-Max"}}`로 기록됐고, 어시스턴트 메시지가 `provider: commandcode`로 물리 모델을 명시했습니다. **LiteLLM 프록시를 거치지 않았습니다.**

### 미검증 / 한계

- **타입 검사 없음.** 저장소에 TypeScript 컴파일러가 없어 `tsc`를 돌릴 수 없습니다. `node --test`는 타입을 스트립해 실행하므로 문법과 스트립 가능성만 검증됩니다.
- **`fetch-scores.mjs`의 공식 API 경로는 미구현.** 키가 없어 검증할 수 없어 미러 경로만 구현했습니다.
- **미러 수명.** HF 미러는 2026-11-04에 종료되는 레거시 AA 엔드포인트로 레코드를 만듭니다. 공식 API(`/api/v2/language/models/free`, `x-api-key`, 100req/24h)가 지속 경로입니다.
- **대화형 UI 미확인.** `/coding-fallback`, `/aaii-router` 명령은 등록·실행되지만 `ctx.ui.notify` 메시지가 화면에 그려지는 것은 TUI에서만 볼 수 있습니다.
- **LiteLLM 런타임 미검증.** 프록시가 실행 중이 아니어서 재생성된 체인의 실제 폴백은 확인하지 못했습니다.

---

## 6. 미해결 / 결정 필요

1. **Pi에서 무엇을 지울지** — `litellm` 항목 2개(`coding-fallback`, `dashscope-coding-fallback`) / `coding-fallback` 확장 / LiteLLM `fallbacks` 매트릭스 / `litellm` provider 자체. 사용자 답변 미수령으로 **삭제 보류**.
2. **`sync` 적용 여부** — 적용하면 코딩 체인 head가 `code-10-qwen3.8-max`로 바뀌고 순서가 재편됩니다. 백업은 자동 생성되며 LiteLLM 재시작이 필요합니다.
3. **미채점 6개 처리** — 별칭 지정 또는 후순위 유지.
4. **ExpLabs 귀속 불일치** — "GLM-5.3 Flash 전용"으로 정정됐으나 설정에는 `code-7-explabs-deepseek-v4.1-flash`와 `code-1-explabs-...`가 올라가 있습니다. 정렬 영향은 없습니다(둘 다 티어/미채점 판정).
5. **`_research/` 정리** — 미추적 스크래치. 커밋하지 않았습니다.

---

## 7. 알려진 함정

- **Pi는 모델을 `provider/id`로 식별합니다.** 같은 provider에 같은 id를 두 번 둘 수 없으므로, 한 모델을 여러 공급자가 재판매하면 provider가 달라야 합니다. `aaii-router`의 중복 제거가 이 제약을 반영합니다.
- **배포 티어 대신 `order:` 사용 가능.** LiteLLM 문서상 `litellm_params.order`로 단일 모델 그룹 안에서 우선순위 폴백을 표현할 수 있습니다. 매트릭스(472줄)를 수십 줄로 줄이는 대안이며 아직 적용하지 않았습니다.
- **Pi의 자동 재시도는 같은 모델만 재시도합니다.** 모델 전환은 `route()`에서만 일어납니다.
- **Safety Guard가 자격증명 형태 리터럴을 차단합니다.** 테스트 픽스처에 `api_key: sk-...` 형태를 넣으면 쓰기가 거부되므로, 픽스처는 `api_base`에서 끊습니다.
- **커밋 메시지에 BOM 주의.** PowerShell 5.1의 `Out-File -Encoding utf8`은 BOM을 붙입니다. `[System.IO.File]::WriteAllText` + `UTF8Encoding($false)`를 사용했습니다.

---

## 8. 주요 커밋

| 커밋 | 내용 |
|---|---|
| `fc80fcd` | OpenRouter catalog filter Pi package (초기) |
| `3787390` | Curate free models for agentic coding |
| `9c86346` | 서비스 종료 모델 필터 + stale 목록 제거 |
| `ee0dc27` | 제외 목록 → 허용 목록 전환 |
| `b977ff5` | 서비스 종료 모델 6개 통합 |
| `ac07723` | LiteLLM 코딩 폴백 생성기 (AAII 순서 이전 버전) |

`aaii-router`와 AAII 정렬 버전은 **아직 커밋하지 않았습니다.**

---

## 9. 비용으로 발생한 외부 호출

검증 과정에서 실제 모델 호출이 2회 발생했습니다: 대조군 테스트 1회(모델 확인용), 라우터 종단 테스트 1회(CommandCode, 약 $0.015). 점수 추출은 Hugging Face 읽기만 사용했습니다.

---
---

# 세션 기록: 2026-10-14 — 무료 모델 자동 포함 + AAII 별칭

작성일: 2026-10-14
상태: **미커밋**
테스트: 26 → **60개** (4개 → 6개 테스트 파일)
라이브 LiteLLM 설정: **미변경** (`sha256 14003c6a5edf86e7d3e7c1b04ac310bca8481c1e7c93cdc74fb088851968a59c`, mtime 2026-10-12 00:43)

---

## A. 이번 세션에서 한 일

### A.1 ExpLabs 가격이 0이 되는 기존 모델을 자동으로 체인에 반영

요청: "ExpLabs가 가끔 코딩 모델 가격이 0원일 때가 있는데 그때 그걸 기존 규칙에 따라
자동으로 포함시키게 할 수 있나?" → **정정**: 새 모델이 생기는 게 아니라 **기존 모델의 가격이
종종 0이 된다.**

사용자가 고른 범위: LiteLLM 체인에 자동 등록 + 스냅샷 자동 갱신 + 명시적 `sync`.

#### A.1.1 발견 근거 (실측)

ExpLabs `/v1/models`를 직접 읽었습니다:

| 시각 (KST) | 엔트리 수 | `ling-3.1-flash` |
|---|---:|---|
| 08:21 | 295 | **$0 / $0**, tools=true, reasoning=true |
| 20:44 | 294 | **목록에서 철회됨** |
| 21:04 | 294 | 여전히 없음 |

즉 프로모가 **12시간 안에 나타났다 사라졌습니다.** 이게 스냅샷 캐시가 필수인 이유입니다.
같은 20분 사이에 `qwen3-coder-plus`가 "가격 있음 → 가격 없음"으로 바뀌기도 했습니다.

#### A.1.2 "무료"와 "가격 미상"의 구분

목록에서 0원처럼 보이는 모양은 셋이고, 무료는 하나뿐입니다:

| 모양 | 처리 |
|---|---|
| `pricing` 있고 input·output 둘 다 `0` | **free** — 후보 |
| `pricing` 객체 자체가 없음 | **no-price** — 잠긴 스텁 |
| 한쪽만 `0` | **partial-free** — 싼 방향이지 무료가 아님 |
| embedding 등 non-completions | **not-chat** — 제외 |
| 0원인데 컨텍스트 창 미공개 | **no-context-window** — 제외 |

잠긴 스텁은 가정이 아닙니다: `qwen3-max`에 chat 요청을 보내면
`{"code": "insufficient_quota", "message": "model_requires_purchase: qwen3-max is locked ..."}` 가
돌아옵니다. 가격 없음을 `$0`으로 읽으면 **매 호출 실패하는 그룹이 체인에 들어갑니다.**
현재 no-price로 기록된 4개: `ernie-4.5-vl-424b-a47b`, `glm-5.2-fast`, `qwen3-max`,
`qwen3.6-max-preview`.

#### A.1.3 두 경우 (정정 후 주 경로는 두 번째)

**이미 그룹이 있는 모델이 0원이 되는 경우 — 주 경로.** 새 그룹을 만들지 않고 티어만
`free`로 바꿉니다. 라이브 설정 실측:

```
code-5-nvidia-deepseek-v4.1-flash       #8  ->  #9
code-6-cline-deepseek-v4.1-flash        #9  ->  #10
code-8-commandcode-deepseek-v4.1-flash  #10 ->  #11
code-7-explabs-deepseek-v4.1-flash      #11 ->  #8   ← $0 플래그
```

같은 모델(39.5)을 파는 유료 3곳을 앞지릅니다. 전체 헤드는 되지 않습니다 — 점수가 1순위라
Qwen3.8 Max 그룹(45.4) 뒤에 남습니다. **기존 규칙 그대로입니다.**

**그룹이 없는 모델이 0원이 되는 경우.** `sync`가 `model_list` 끝에 그룹을 생성합니다:

```yaml
- model_name: code-free-explabs-ling-3.1-flash
  litellm_params:
    model: openai/ling-3.1-flash
    api_base: https://api.experientiallabs.ai/v1
    api_key: os.environ/EXPLABS_API_KEY
```

`code-free-` 접두사가 곧 prune 마커입니다. 매 compose마다 지우고 다시 만들기 때문에 프로모가
끝나면 그룹도 사라집니다.

#### A.1.4 안전장치 3개 (테스트로 고정)

- **손으로 쓴 엔트리는 안 건드림.** 같은 모델을 이미 서빙 중이면 그룹을 만들지 않고
  `alreadyPresent`로 보고.
- **스냅샷이 말하는 호스트만 prune.** 스냅샷이 없거나·깨졌거나·해당 호스트를 못 읽었으면
  `model_list`를 **정확히 그대로** 둡니다. 파일 소실이 "프로모 종료"처럼 보이면 안 됩니다.
- **프로브 실패는 스냅샷을 덮어쓰지 않음.** 네트워크 오류 후 빈 목록을 쓰면 그게
  "프로모 종료"로 읽혀 아직 무료인 그룹을 철거합니다.

#### A.1.5 자동성

| 시점 | 동작 |
|---|---|
| 세션 시작 | 스냅샷이 6시간보다 오래됐으면 **백그라운드** 갱신 (await 안 함 — 세션이 네트워크를 기다리지 않게) |
| `/coding-fallback sync` | **먼저 목록을 새로 읽고** compose (결정하는 순간이므로) |
| `PI_CODING_FALLBACK_FREE_REFRESH=off` | 네트워크 읽기 전면 중단 |

#### A.1.6 종단 확인 (실제 기록된 목록으로 라이브 설정 compose)

| 입력 | 결과 |
|---|---|
| 08:21 목록 (`ling-3.1-flash` $0/$0) | 그룹 생성, coding chain **14 → 15** 멤버, fallbacks에 등장 |
| 20:44 목록 (철회) | 포함 0, 그룹 제거 |
| 디스크의 현재 스냅샷 (0개 free) | **`model_list` 변경 0건** |

### A.2 AAII 별칭 — uncensored 파인튜브 순위 편입

사용자 정정: "Qwen3.8 flash next AAII 점수 40인데?"

확인 결과와 처리:

- 파일이 가진 값은 **39.8**입니다 (`qwen3.8-flash-next`, slug `qwen3-8-flash-next`,
  indexVersion 4.3.x, 2026-10-13 스냅샷). 공식 API가 막혀(아래 D항) **40은 확인하지
  못했습니다.** 미러를 오늘 다시 받아도 39.8입니다.
- 진짜 문제는 **uncensored 파인튜닝에 AA 항목이 따로 없다**는 점이었습니다. 그래서 `scores`
  테이블만 보면 미채점이었습니다.
- `aaii-scores.json`의 **비어 있던 `aliases` 맵**에 운영자 결정을 기록했습니다:

```json
"aliases":    { "qwen3.8-flash-next-uncensored": "qwen3.8-flash-next" },
"aliasNotes": { "qwen3.8-flash-next-uncensored": "Operator decision: ..." }
```

효과: `code-1-explabs-qwen3.8-flash-next-uncensored`이 **미채점 맨 뒤 → #8/14**.
무료일 때만이 아니라 **상시** 적용됩니다. 한 줄 지우면 원래대로 돌아갑니다.

같은 모델을 재판매하는 공급자가 없어서, 이 모델을 $0으로 표시해도 **#8에 그대로**입니다
— 무료 티어는 이길 동률이 있을 때만 드러납니다.

#### A.2.1 이 과정에서 드러난 진짜 결함 2개

**1. 갱신이 별칭을 지웠다.** `fetch-scores.mjs`가 스냅샷을 쓸 때 `aliases: {}`를
하드코딩하고 있었습니다. 즉 결정을 기록해도 다음 갱신에서 조용히 사라지고 모델이 다시
뒤로 갔을 겁니다. 이제 `aliases`·`aliasNotes`를 **기존 파일에서 이어받습니다.**

실제로 복사본에 `--out`으로 돌려 확인:

```
carrying forward 1 alias(es) from _research/.tmp/scorecopy.json
resolved 19/25 scores -> _research/.tmp/scorecopy.json
```

**2. 첫 편집이 무효였다.** `aliases`를 위쪽에 넣었는데 파일 끝에 이미 `"aliases": {}`가
있어서 JSON last-wins로 덮였습니다. 이제 **라이브 스냅샷에 별칭이 최소 1개 있다**는
테스트를 추가해서 같은 실수가 조용히 넘어가지 않습니다.

---

## B. 파일 변경

### 신규

| 파일 | 내용 |
|---|---|
| `extensions/coding-fallback/free-models.ts` | 가격 분류, 스냅샷 파서·로더, 관리 엔트리 명명, free 키 |
| `extensions/coding-fallback/free-fetch.ts` | 프로브 + 스냅샷 원자적 기록 (Pi SDK 미사용) |
| `extensions/coding-fallback/fetch-free.mjs` | CLI (`--dry` / `--force` / `--out`) |
| `extensions/coding-fallback/free-models.json` | 스냅샷 (294 listed, 0 free, 4 no-price) |
| `extensions/coding-fallback/free-models.test.ts` | 19개 |
| `extensions/coding-fallback/scores.test.ts` | 7개 |

### 수정

| 파일 | 변경 |
|---|---|
| `chain.ts` | `composeCodingFallback(config, scores, free?)`, `reconcileFreeEntries`, `tierForEntry`, `CODING_CHAIN.matches` 확장 |
| `config.ts` | 스냅샷 로드 + 보고 문구, `checkFallback`/`syncFallback`에 세 번째 경로 |
| `index.ts` | 세션 시작 백그라운드 갱신, `sync` 시 갱신, `PI_CODING_FALLBACK_FREE*` |
| `providers.ts` | `tierForHost` 주석에 모델 단위 오버라이드 위치 명시 |
| `scores.ts` | `aliasMapsFromSnapshot` 추가 |
| `fetch-scores.mjs` | `scores`는 재생성, `aliases`·`aliasNotes`는 이어받음 |
| `aaii-scores.json` | `aliases` + `aliasNotes` 기록 |
| `README.md` | `## Free models` 섹션, 별칭 절차, 한계 |

`chain.test.ts`·`config.test.ts`는 **한 줄도 수정하지 않았습니다** — 새 파라미터는 전부 optional입니다.

---

## C. 검증

### 통과

| 검증 | 방법 | 결과 |
|---|---|---|
| 전체 테스트 | `node --test` (6개 파일) | **60/60**, exit 0 |
| Pi 로드 | `pi -e . --list-models` | exit 0, **stderr 0바이트**, dashscope 29 · explabs 2 유지 |
| 스냅샷 왕복 | 실제 기록 목록으로 compose | 무료 있을 때 14→15 멤버, 없을 때 `model_list` 무변경 |
| 별칭 보존 | `fetch-scores.mjs --out <복사본>` 실제 실행 | `carrying forward 1 alias(es)`, 별칭·이유 유지 |
| 별칭 효과 | 라이브 설정 `orderChain` | `code-1-...uncensored` #8/14 |
| 라이브 설정 무결성 | sha256 | **미변경** (`14003c6a…`) |
| 라이브 스냅샷 무결성 | `retrieved` | 미변경 (2026-10-13) |

### 미검증 / 한계

- **타입 검사 없음** (기존과 동일). `tsc` 미설치 — 타입 오류는 테스트가 실제 실행한
  경로에서만 잡혔습니다.
- **LiteLLM 프록시 런타임 미검증.** 무료 모델로 실제 폴백을 돌려보지 못했습니다.
- **AA 공식 API 접근 불가** (아래 D).
- 별칭은 **베이스 모델 점수를 파인튜브에 적용하는 추론**입니다. 그 자체 품질은
  어디서도 측정되지 않았습니다 — 그래서 코드가 아니라 파일에 이유와 함께 기록했습니다.
- 무료 티어는 **동률 그룹 안에서만** 재정렬하며 점수를 넘지 못합니다.
- 생성 그룹은 `code-*` 체인 전용입니다 (`ds-*` 체인은 한 업스트림 카탈로그라 대응 없음).
- 스냅샷은 구독이 아니라 **캐시**입니다. 6시간 창 사이에 나타났다 사라진 프로모는 놓칩니다.

---

## D. 이전 기록(2026-10-13)에 대한 정정

**1. §5의 "키가 없어 검증할 수 없어 미러 경로만 구현했습니다" → 정정.**

키는 환경에 있습니다 (`AA_API_KEY`, 12자). 하지만 **무효**입니다:

| 헤더 | 응답 |
|---|---|
| `x-api-key: <key>` | `401 {"error":"Invalid API key."}` |
| `Authorization: Bearer <key>` | `401 {"error":"API keys go in the x-api-key header"}` |

두 번째 응답이 "헤더 형식은 맞다"는 걸 알려주므로, **헤더 문제가 아니라 키가 거부되는
것**입니다. 공식 경로는 여전히 미구현이고, **미러가 이 저장소가 실제로 읽을 수 있는 유일한
소스**입니다.

→ 지난번에 "`AA_API_KEY`를 발견해서 공식 AAAPI 경로가 이제 막혀 있지 않습니다"라고 적은
것은 **틀렸습니다.** 키의 존재를 유효성으로 잘못 읽었습니다.

**2. §4.1의 "미확보 6개 … (미지정 상태)" → 1개 편입 완료.**

`qwen3.8-flash-next-uncensored` → 39.8 (§A.2). 남은 5개는 그대로 미지정:
`qwen3.8-flash-next-iq3_s`, `qwen3.5-flash`, `qwen3.5-plus`, `qwen3.6-flash`, `qwen3.7-flash`.

**3. §4.2 ExpLabs 행의 "가끔 무료 코딩 모델" → 이제 자동 감지·포함됩니다.**

단, ExpLabs 그룹은 설정에 2개뿐이고 그중 동률 그룹을 이루는 건 `deepseek-v4.1-flash`(39.5)
하나입니다. `qwen3.8-flash-next-uncensored`은 같은 모델을 재판매하는 곳이 없어 프로모가
떠도 순위가 변하지 않습니다.

**4. §1의 "테스트 26/26 (3개 테스트 파일)" → 현재 60/60 (6개 파일).**

---

## E. 결정 필요

1. **`qwen3.8-flash-next-iq3_s` 별칭 여부** — 같은 상황(로컬 양자화, AA 항목 없음). 의도적으로
   미적용 상태입니다. **답변 대기 중**입니다.
2. **`sync` 적용 여부** — 라이브 설정은 이번 변경 **이전부터 drifted**입니다(fallbacks 블록이
   `model_list`와 467줄 불일치). 적용하면 코딩 체인 head가 `code-10-qwen3.8-max`로 바뀌고
   순서가 재편됩니다. 백업은 자동, LiteLLM 재시작 필요.
3. **프로브 대상 확장** — `FREE_PROBE_TARGETS`는 이미 다중 공급자 모양이라 다른 티어로 넓히는
   것은 데이터 한 줄 추가에 가깝습니다.
4. **미커밋** — 이번 세션 변경 전부 미커밋.
5. 지난 기록 §6의 1·2번(무엇을 지울지 / sync 승인)은 **여전히 미해결**입니다.

---

## F. 이번 세션의 함정

- **JSON 중복 키는 조용히 진다.** `aaii-scores.json`에는 이미 파일 끝에 `"aliases": {}`가
  있었고, 위쪽에 새로 넣은 `aliases`가 last-wins로 덮였습니다. 파싱은 성공하므로 오류가
  보이지 않습니다. 라이브 스냅샷 상태를 직접 assert하는 테스트로 고정했습니다.
- **"가격이 더 이상 무료 아님"과 "파일이 없음"은 다릅니다.** 후자는 prune하지 않고
  `model_list`를 그대로 둡니다. 반대 방향의 함정도 있습니다: 영구적으로 못 읽는 호스트가
  생기면 그 호스트의 생성 그룹은 **보존된 채로 남습니다.** 현재 해당 없음.
- **`free-models.json`은 빠르게 낡습니다.** `retrieved`를 기록하고 7일 초과 시 경고를 붙입니다.
- **프로브가 다른 파일과 경쟁하지 않습니다.** 임시 파일에 쓰고 `rename`으로 교체합니다.

---

## G. 비용으로 발생한 외부 호출 (이번 세션)

**실제 모델 호출 0회 — 비용 $0.** 전부 읽기 전용 HTTP GET입니다:

| 대상 | 횟수 | 비고 |
|---|---:|---|
| `api.experientiallabs.ai/v1/models` | 3 | 목록 읽기 (08:21 / 20:44 / 21:04) |
| Hugging Face 미러 | 1회 전체 | `fetch-scores.mjs --out <복사본>` — 25개 모델 샘플링 |
| `artificialanalysis.ai/api/v2/...` | 3 | 전부 401 |

`_research/.tmp/`에 남긴 증거 파일: `explabs.json`(08:21, 295개),
`explabs-models.json`(20:44, 294개), `resp.json`(`model_requires_purchase` 오류 응답).
`explabs.json`은 `ling-3.1-flash`가 실제로 $0/$0이었음을 보이는 **유일한 증거**이므로
지우지 않았습니다.

---
---

# 세션 기록: 2026-10-17 — OpenRouter 카탈로그 필터 on/off 슬래시 명령

작성일: 2026-10-17
상태: **미커밋**
대상: `extensions/openrouter-catalog-filter/` (신규 2개 파일, 수정 2개)
테스트: `state.test.ts` 8개 신규. 전체 94개 중 **92/94** (아래 C.2의 2개 실패는 이번 변경과 무관)

---

## A. 이번 세션에서 한 일

요청: "pi 내부에서 '/'를 앞에 붙인 명령어로 조작할 수 있게 해줘."

이 확장은 `pi.registerProvider("openrouter", { models })`로 프로바이더 카탈로그를
**대체**합니다. 그래서 on/off는 "필터 강도"가 아니라 **override의 존재 여부**입니다:
off = `pi.unregisterProvider("openrouter")` → Pi가 원래대로 카탈로그를 구성.

```
/openrouter-catalog-filter          = status
/openrouter-catalog-filter status   지금 상태와 유지 중인 모델 수
/openrouter-catalog-filter off      override 제거
/openrouter-catalog-filter on       다시 좁히기
/openrouter-catalog-filter reload   카탈로그 재요청 후 재적용
/openrouter-catalog-filter list     allowlist가 남긴 모델 id
```

- 상태 파일: 에이전트 디렉터리의 `openrouter-catalog-filter.json` (`PI_OPENROUTER_FILTER_STATE`로 경로 변경)
- 우선순위: **환경변수 `PI_OPENROUTER_FILTER` > 파일 > 기본값**, 기본값은 **on**
  (스위치가 없던 시절의 동작을 유지 — 업그레이드가 남의 모델 목록을 넓히면 안 됨)
- 읽을 수 없는 값은 추측하지 않고 보고합니다("enabled" 없음 / JSON 아님 / `on|off` 아님)
- 쓰기는 임시 파일 + `rename` (원자적)

## B. 파일 변경

| 파일 | 내용 |
|---|---|
| `extensions/openrouter-catalog-filter/state.ts` | 신규 — 파싱·우선순위·문구·완성·파일 I/O (Pi SDK 미사용) |
| `extensions/openrouter-catalog-filter/state.test.ts` | 신규 — 8개 |
| `extensions/openrouter-catalog-filter/index.ts` | `registerCommand` + 상태에 따른 register/unregister |
| `extensions/openrouter-catalog-filter/README.md` | `## Turning the allowlist off` 절, 실측 기준으로 목록 수 정정 |

## C. 검증

### C.1 통과

| 검증 | 방법 | 결과 |
|---|---|---|
| 확장 테스트 | `node --test extensions/openrouter-catalog-filter/*.test.ts` | **8/8**, exit 0 |
| 명령 등록 | RPC `get_commands` | `openrouter-catalog-filter` 노출 |
| 명령 동작 | RPC `prompt` 1건씩 순차 전송 | status/off/status/list/on/오타/reload 전부 기대 문구 · off는 `disposition: handled` |
| 상태 파일 | off → `{"enabled": false}`, on → `{"enabled": true}` | 확인 |
| 세션 내 반영 | off 후 status | `override: removed, so Pi composes the OpenRouter provider itself` |
| **다른 프로세스에 반영** | 명령으로 off → 새 프로세스 `pi --list-models openrouter` | **396행** (on이면 17행) |
| 환경변수 override | 파일 off + `PI_OPENROUTER_FILTER=on` → 17행 | 확인 |
| 잘못된 값 | 파일 off + `PI_OPENROUTER_FILTER=sometimes` → 396행 (파일이 이김) | 확인 |
| 실제 에이전트 디렉터리 | `~/.pi/agent/openrouter-catalog-filter.json` | **생성되지 않음** (테스트는 `PI_OPENROUTER_FILTER_STATE`로 /tmp 사용) |

### C.2 실패 (이번 변경과 무관)

`node --test extensions/*/*.test.ts` → 94개 중 2개 실패:

- `chain.test.ts` "leaves everything outside the two generated blocks untouched"
- `free-models.test.ts` "the live config accepts a generated group without disturbing its own entries"

둘 다 저장소 밖 파일 `~/.pi/agent/litellm_config.yaml`을 읽습니다. 이 파일이
**2026-10-16 22:40에 1,236바이트짜리 다른 설정으로 교체**되어 `dashscope-coding-fallback`
그룹이 사라졌고, 그래서 `no model_list entries match chain "dashscope-coding-fallback"`로
compose가 거부됩니다. 저장소 소스 문제가 아니라 라이브 설정 드리프트이며, 해소하려면
`sync` 적용(§E.2의 미해결 결정)이 필요합니다. 이번 변경 전후 로그가 동일합니다.

## D. 한계

- **타입 검사 없음.** 저장소에 TypeScript 컴파일러가 없어 `tsc`를 돌릴 수 없습니다.
  `node --test`는 타입을 스트립하므로 문법·스트립 가능성만 검증됩니다.
- **대화형 TUI는 직접 몰아보지 않았습니다.** 검증은 RPC 모드로 했고, 두 모드가 같은
  `agent-session._tryExecuteExtensionCommand` 경로를 씁니다. 카탈로그 행 수는 별도
  프로세스의 `--list-models`로 교차 확인했습니다.
- **복사본 2개가 붙으면 싸웁니다.** 설치본(git main)과 `-e`로 넘긴 체크아웃이 동시에 로드되면
  provider를 무조건 등록하는 예전 복사본이 이깁니다. 검증은 `-ne -e <이 리포 경로>`로 분리해서 했습니다.

## E. 비용으로 발생한 외부 호출 (이번 세션)

**모델 호출 0회 — 비용 $0.** 모든 실행에 `PI_OFFLINE=1`을 걸어 네트워크 요청도 없습니다.

---
---

# 세션 기록: 2026-10-17 — coding-fallback 모델 등록 TUI

작성일: 2026-10-17
상태: **미커밋**
대상: `extensions/coding-fallback/` (신규 2개, 수정 4개)
테스트: coding-fallback **66개 중 64개 통과** (실패 2개는 라이브 설정 드리프트, 아래 C.3)

---

## A. 이번 세션에서 한 일

요청: "coding fallback에 model을 등록하는 tui를 만들어줘. extention들이 흔히 사용하는 방식으로."

"등록"은 `model_list`에 hand-written 그룹 하나를 추가하는 일입니다(체인은 거기서 조합됨).
사용자가 고른 범위 세 가지:

| 결정 | 선택 |
|---|---|
| 쓰기 범위 | 항목 추가 **+ 즉시 sync** (백업 자동 = 기존 `sync` 경로) |
| 업스트림 | **설정에 이미 있는 host 재사용만** (api_base/api_key를 복사) |
| 체인 | **coding-fallback만** (`code-<n>-`) |

TUI 방식은 같은 저장소의 `/aaii-router settings` 창과 동일한 관례입니다:
`ctx.ui.input` / `ctx.ui.select` / `ctx.ui.confirm`, UI가 없으면 스크립트형 경로 안내.
다른 점은 **선형 마법사**라는 것 — 설정 창은 메뉴를 반복하지만 여기서는 각 답이 다음
질문의 전제이고 마지막 단계가 프록시 설정을 씁니다.

```
/coding-fallback add                     창: 모델 id → 업스트림 선택 → 이름 → 확인
/coding-fallback add <model> <host-or-slug> [<group-name>]
                                         같은 등록을 창 없이
```

## B. 파일 변경

| 파일 | 내용 |
|---|---|
| `extensions/coding-fallback/register.ts` | 신규 — 순수 규칙: 업스트림 목록, slug 판정, 번호, 검증, 엔트리 삽입, 대화 문구, 완성 |
| `extensions/coding-fallback/register.test.ts` | 신규 — 17개 |
| `extensions/coding-fallback/config.ts` | `readConfig`, `readInputs`/`composeText` 분리, `addModel` (한 번 쓰기, 백업, 두 가드) |
| `extensions/coding-fallback/index.ts` | `add` 서브커맨드(창 + 스크립트), 인자 완성, 문서 헤더 |
| `extensions/coding-fallback/chain.ts` | `readModelEntryDetails` 추가(api_key까지 읽음), `reordered` 비교 버그 수정(C.2) |
| `extensions/coding-fallback/config.test.ts` | `addModel` 4개 |
| `extensions/coding-fallback/chain.test.ts` | 순서 변경 비교 1개 |
| `extensions/coding-fallback/README.md` | `## Adding a model` 절(창·스크립트형·거부 목록), 명령 목록, 한계 3줄, 검증 절 |

## C. 검증

### C.1 통과

| 검증 | 방법 | 결과 |
|---|---|---|
| 순수 규칙 | `node --test register.test.ts` | **17/17**, exit 0 |
| 쓰기 경로 | `node --test config.test.ts` | **12/12** (백업 내용, 체인 반영, 무점수=뒤, 중복/미해석 거부 시 무변경) |
| coding-fallback 전체 | `node --test extensions/coding-fallback/*.test.ts` | 66개 중 **64**, 실패 2개는 C.3 |
| **실제 pi 종단** | RPC 모드에서 `add` 3건 (스크립트 1 + 창 2) | 아래 C.2 |

### C.2 종단 실행 (임시 사본, 실제 pi 프로세스)

`PI_CODING_FALLBACK_CONFIG/SCORES`를 임시 사본으로, `PI_CODING_FALLBACK_FREE_REFRESH=off`
로 네트워크를 끈 상태에서 RPC 모드로 명령을 하나씩 보내고, 창의 select/input/confirm을
운영자가 답하듯 응답했습니다.

- `/coding-fallback check` → `out of date — coding-fallback (2 members, head code-4-explabs-glm-5.3-flash)`
- `/coding-fallback nope` → `unknown subcommand`
- `/coding-fallback add deepseek-v4.1-flash` (업스트림 미지정) → `name one upstream — nvidia, explabs, dashscope-intl.aliyuncs.com`
- `/coding-fallback add deepseek-v4.1-flash nvidia` → 확인 대화(렌더된 YAML + AAII 39.5 + tier daily) → `added code-5-nvidia-deepseek-v4.1-flash`
- 창 1: `glm-5.3-flash` → 업스트림 선택(`api.experientiallabs.ai — explabs, monthly`) → 이름 `code-6-explabs-glm-5.3-flash` → `added`
- 창 2: `qwen3.5-27b` → `dashscope-intl.aliyuncs.com`(**slug 없음**) → 슬러그 입력 `dashscope` → `code-7-dashscope-qwen3.5-27b` → `added`
- 마지막 `check` → **`up to date`**, `model_list` 그룹 6개, 백업 3개, `model_group_alias`의 coding head = `code-4-explabs-glm-5.3-flash`

### C.3 이번 변경과 무관한 실패 (기존)

`chain.test.ts` "leaves everything outside the two generated blocks untouched"와
`free-models.test.ts` "the live config accepts a generated group without disturbing its own entries"는
저장소 밖 `~/.pi/agent/litellm_config.yaml`이 2026-10-16 22:40에 다른 설정으로 교체되어
`dashscope-coding-fallback` 그룹이 없기 때문에 실패합니다(이번 변경 전후 동일). 해소하려면
`sync` 적용이 필요한데, 그건 §E.2의 미해결 결정입니다. **그래서 TUI 실측도 라이브 파일이 아니라
임시 사본으로 했고, 라이브 설정은 읽지도 쓰지도 않았습니다.**

## D. 부수 수정: 거짓 "order changes" 알림

`reordered`는 `fallbacks` 블록의 alias 목록(코딩 체인은 `aliasIncludesHead: false`라 **머리를 뺀** 목록)과
조합된 **전체** 목록을 비교하고 있었습니다. 그래서 이미 올바른 설정도 매번 순서 변경으로 보고됐고,
실제로 `up to date`와 `order changes`가 같은 메시지에 함께 나왔습니다. 머리(`model_group_alias`)까지
읽어 같은 형태로 비교하도록 고치고, 문구를 `the order changes (N -> M members, head A -> B)`로 바꿨습니다
(머리가 그대로면 이동 표기를 생략 — 이전에는 `X -> X`로 나왔습니다). 등록 알림이 이 문구를 그대로
쓰기 때문에, 새 기능을 붙이면서 드러난 이 버그도 함께 고쳤습니다.

## E. 한계

- **타입 검사 없음** — 저장소에 TypeScript 컴파일러가 없습니다. `node --test`는 타입을 스트립합니다.
- **실제 키 입력 TUI는 미실행.** 검증은 RPC 모드의 같은 UI 컨텍스트(select/input/confirm)를
  스크립트가 응답하는 방식이고, 대화형 편집기의 자동완성은 그리지 않았습니다. 인자 완성은
  SDK가 `getArgumentCompletions`를 읽는 것과 순수 함수 테스트로만 확인했습니다.
- **등록만 한다** — 창은 기존 그룹을 고치거나 지우지 않고, 새 호스트도 만들지 않습니다(설계 범위).
- **라이브 설정에는 지금 등록할 수 없습니다** — 위 C.3 때문에 compose 단계에서 거부되고,
  그 경우 아무것도 쓰지 않습니다(메시지에 이유가 나옵니다).

## F. 비용으로 발생한 외부 호출 (이번 세션)

**모델 호출 0회 — 비용 $0.** 모든 실행에 `PI_CODING_FALLBACK_FREE_REFRESH=off`를 걸어
무료 모델 목록 조회도 하지 않았습니다.

---
---

# 세션 기록: 2026-10-17 (2) — coding-fallback 등록을 선택 방식으로

작성일: 2026-10-17
상태: **미커밋**
대상: `extensions/coding-fallback/` (신규 6개, 수정 4개)
테스트: 저장소 전체 **151개 중 149개 통과** (실패 2개는 라이브 설정 드리프트, 아래 C.3)

---

## A. 이번 세션에서 한 일

요청: "타이핑해서 하는거 말고 pi-model-picker 처럼 선택해서 목록에 추가하는 방식으로 만들어"

두 가지를 먼저 정했습니다.

| 결정 | 선택 |
|---|---|
| 목록 출처 | 업스트림의 `/v1/models` (읽지 못하면 **설정이 다른 host에서 이미 쓰는 id** — 점수표가 아님) |
| 선택 개수 | 여러 개 (space 표시 → enter 등록) |

부품은 pi 자신의 `/model` 선택기와 pi-model-picker가 쓰는 것과 같습니다:
`ctx.ui.custom` + `@earendil-works/pi-tui`의 `SelectList`/`Input`. 내장 `ctx.ui.select`는
↑↓/Enter만이라 타이핑 필터가 없고, 목록이 수백 개인 업스트림에는 쓸 수 없습니다.

```
/coding-fallback add                     업스트림 선택 → 목록에서 표시 → 확인 → 한 번 쓰기
/coding-fallback add <model> <host-or-slug> [<group-name>]   같은 등록을 선택 없이
```

키: 타이핑=필터(fuzzy, Pi 선택기와 같은 matcher) · ↑↓=이동(양끝 순환) · space=표시/해제 ·
enter=표시된 행 등록(표시가 없으면 커서 행) · esc=취소. 표시는 필터를 바꿔도 유지됩니다.
이미 그 host가 서비스하는 id는 목록에서 빼고 제목에 개수로만 알립니다(다른 host의 같은
모델은 계속 후보 — LiteLLM은 그룹 이름으로 해석하므로 같은 모델의 두 번째 공급자가 폴백의 요점).

## B. 파일 변경

| 파일 | 내용 |
|---|---|
| `listing.ts` | 신규 — 업스트림 `/v1/models` 읽기: `api_base`→URL, `os.environ/NAME` 키 해석, 페이로드 모양 3가지 파싱, 실패는 예외가 아니라 이유 |
| `listing.test.ts` | 신규 — 9개. 실제 요청 경로는 **127.0.0.1 루프백 서버**로 검증 |
| `catalog.ts` | 신규 — 순수 규칙: 후보 선정(host별 이미 서비스 중 제외), 정렬, 표시 집합, enter의 의미, 배치 이름, 제목·힌트·확인 문구 |
| `catalog.test.ts` | 신규 — 15개 |
| `picker.ts` | 신규 — `SelectList`+`Input` 멀티셀렉트 컴포넌트(필터·표시·enter·esc, 표시가 바뀌면 목록을 다시 만들되 커서/필터 복원) |
| `picker.test.ts` | 신규 — 8개. SDK가 저장소에 없으므로 임시 디렉터리에 확장을 복사하고 `pi-tui`/`pi-coding-agent` 스텁 패키지를 옆에 두고 실제 컴포넌트를 구동 |
| `config.ts` | `addModels`(배치) — 한 번의 compose·한 번의 백업. 거부 시 **어느 엔트리도 추가되지 않았는지 이름으로** 보고 |
| `config.test.ts` | 배치 3개(한 번 쓰기·한 번 백업 / 배치 전체 거부와 이름 / 한 이름을 두 번 쓰는 배치는 아무것도 쓰지 않음) |
| `index.ts` | `add` 인자 없음 → 업스트림 선택 → (slug 없으면 입력) → picker → 이름 → 확인 → 한 번 쓰기. RPC/print 가드 |
| `README.md` | `## Adding a model` 재작성(목록 출처·키 표·폴백·이름·TUI 제약), 검증 절, 한계 2줄 |

## C. 검증

### C.1 통과

| 파일 | 결과 |
|---|---|
| `catalog.test.ts` | **15/15** |
| `config.test.ts` | **15/15** (기존 12 + 이번 3) |
| `listing.test.ts` | **9/9** |
| `picker.test.ts` | **8/8** |
| `register.test.ts` | 17/17 |
| `scores.test.ts` | 7/7 |
| `chain.test.ts` | 10/11 (실패 1은 C.3) |
| `free-models.test.ts` | 18/19 (실패 1은 C.3) |
| coding-fallback 합계 | **101개 중 99개** |
| 저장소 전체 | **151개 중 149개** |

### C.2 종단 실행 (실제 pi 1.3.0, RPC, 라이브 설정 미사용)

`PI_CODING_FALLBACK_CONFIG`를 임시 사본으로, `PI_CODING_FALLBACK_FREE_REFRESH=off` +
`PI_OFFLINE=1`로 네트워크를 끄고, 설치된 pi의 CLI를 `--mode rpc -e <이 리포의 index.ts>
--no-extensions ...`로 띄워 명령을 보냈습니다(확인 대화는 RPC 확장 UI 프로토콜로 응답).

- `/coding-fallback add` (인자 없음) → `coding-fallback: the picker needs the TUI (this session is "rpc"). Use `/coding-fallback add <model-id> <host-or-slug> [<group-name>]` here.`
  — 문서(`rpc-extension-ui.md`)가 말하는 그대로입니다: RPC는 `hasUI: true`이고 `custom()`은
  `undefined`를 돌려줍니다. **가드가 없으면 조용히 아무것도 하지 않습니다.**
- `/coding-fallback add deepseek-v4.1-flash explabs` → 확인 대화(렌더된 YAML 5줄) → `added code-3-explabs-deepseek-v4.1-flash`
  — 임시 사본에 `api_base`/`api_key`가 복사된 완전한 엔트리가 들어가고, 백업이 **정확히 1개** 생겼습니다.
- 실행 후 라이브 `~/.pi/agent/litellm_config.yaml`은 **1,236바이트 · mtime 2026-10-16 22:40 그대로**(읽지도 쓰지도 않음).

### C.3 실패 2건 (이번 변경과 무관, 기존)

`chain.test.ts` "leaves everything outside the two generated blocks untouched"와
`free-models.test.ts` "the live config accepts a generated group without disturbing its own entries"는
저장소 밖 파일이 2026-10-16 22:40에 1,236바이트 설정으로 교체되어 `dashscope-coding-fallback`의
멤버가 사라졌기 때문에 compose가 거부됩니다(이전 세션 기록의 C.3과 동일, 로그 동일).

### C.4 검증 중 발견해 고친 회귀

`addModels`를 도입할 때 거부 문구를 `nothing was added`로 바꾸면서 `config.test.ts`의
`/code-3-nvidia-model-x was not added/` 단언이 깨졌습니다(= 배치 전체가 거부될 때 **무엇이 안
들어갔는지** 이름이 사라짐). 그래서 한 건이면 `X was not added`, 배치면 `none of X, Y was added`로
이름을 되돌려 넣었습니다. 테스트가 잡은 실제 회귀입니다.

## D. 한계

- **타입 검사 없음** — 저장소에 `tsc`가 없습니다. 대신 SDK 계약을 정적으로 확인했습니다:
  `custom<T>(factory: (tui, theme, keybindings, done) => Component | Promise<Component>): Promise<T>`
  (types.d.ts:121), `SelectList(items, maxVisible, theme, layout?)` + `onSelect/onCancel/onSelectionChange`
  (select-list.d.ts), `getSelectListTheme()` (index.d.ts:38), `Theme.fg(color, text)`/`bold`
  (theme.d.ts:69,72), 색 토큰 `accent`/`dim`(theme-tokens), 그리고 RPC 문서의 `ctx.mode === "tui"` 권고.
- **실제 터미널 TUI는 몰아보지 않았습니다.** 컴포넌트는 스텁 SDK로 키 시퀀스(`\x1b[B`, `\r`, `\x1b`, `" "`)를
  넣어 검증했고, 실제 화면 폭에서의 줄바꿈·Pi가 그리는 하이라이트는 사용해 봐야 확인됩니다.
- **목록 폴백은 "설정이 아는 id"만** — 아무도 안 쓰는 id는 스크립트형으로 타이핑해야 합니다(설계).
- **라이브 설정에는 지금 등록이 거부됩니다** — C.3 때문에 compose 단계에서 멈추고, 그 경우 아무것도 쓰지 않습니다.
  해소는 `sync` 적용(미해결 결정)입니다.
- 설치본은 10-13 커밋이라 평소 세션에서 쓰려면 푸시 후 `pi update --extensions`가 필요합니다.

## E. 비용으로 발생한 외부 호출 (이번 세션)

**모델 호출 0회 — 비용 $0.** 네트워크 요청은 (1) 테스트가 스스로 띄운 `127.0.0.1` HTTP 서버,
(2) 업스트림 목록 조회 코드 경로(테스트에서만 루프백으로 실행)뿐이고, 실제 인터넷 요청은
`PI_CODING_FALLBACK_FREE_REFRESH=off` + `PI_OFFLINE=1` 덕분에 0회입니다.
