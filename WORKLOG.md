# 작업 기록 (Work Log)

작성일: 2026-10-17
저장소: `D:\repository\pi-coding-chain` (GitHub: `kijonggong/pi-coding-chain`, private)
대상 확장: `coding-fallback`, `aaii-router`, `quota-providers`, `openrouter-catalog-filter`

---

## 1. 이 저장소가 왜 생겼나

기존 저장소 `pi-openrouter-catalog-filter`는 이름과 달리 확장 4개를 함께 담고 있었습니다.
그중 `coding-fallback`은 등록 피커·점수 스냅샷·무료 모델 조회까지 커져 사실상 독립 패키지가
됐는데도 같은 매니페스트를 썼기 때문에, 한 확장을 고치면 4개를 함께 재설치해야 했습니다.

`aaii-router`와 `quota-providers`는 `coding-fallback`의 티어표(`providers.ts`), AAII 읽기
(`scores.ts`), `model_list` 파서(`chain.ts`)를 `../coding-fallback/...`로 import 합니다. 즉 셋은
**한 라이브러리와 그 소비자**라서 같은 저장소에 있어야 합니다. `openrouter-catalog-filter`만
공유 코드가 없습니다.

## 2. 옮긴 것

4개 확장 전체 + `package.json`(`pi.extensions` 4개) + 루트 README. 테스트 파일도 함께 옮겼습니다.

## 3. 발견해서 고친 문제

**매니페스트 버그 (커밋 `111dfcc`).** 첫 커밋의 `package.json`이 `extensions/coding-fallback`
하나만 선언했고(패키지 이름도 `pi-coding-fallback`) 그대로 설치되어, 세션에서 `/aaii-router`,
`/quota-providers`, `/openrouter-catalog-filter`가 **명령으로 등록되지 않았습니다**. RPC 실측에서
`/aaii-router`가 `disposition: "started"`로 돌아왔는데, 이는 확장 명령이 아니라 모델에게 일반
메시지로 전달됐다는 뜻입니다. 4개를 모두 선언하고 이름을 `pi-coding-chain`으로 맞춰 해결했습니다.

## 4. 검증 (실제 pi 1.3.0, RPC 모드, 명령마다 새 프로세스)

| 명령 | 결과 |
|---|---|
| `/coding-fallback add` | `handled` — 피커는 TUI 전용이라 RPC에서는 안내 문구 |
| `/coding-fallback nope` | `handled` — `unknown subcommand \`nope\`. Try check, sync, add` |
| `/aaii-router` | `handled` — `198 candidates, scores 2026-10-13 (164 unranked (no AAII score), 17 with no quota tier)` |
| `/quota-providers` | `handled` — `dashscope: 29 models via https://dashscope-intl.aliyuncs.com/compatible-mode/v1 (key from $DASHSCOPE_API_KEY)` |
| `/openrouter-catalog-filter status` | `handled` — `allowlist on (default)` |

`node --test extensions/` → **151개 중 149개 통과**. 실패 2개는 저장소 밖
`~/.pi/agent/litellm_config.yaml`이 2026-10-16 22:40에 교체되어 `dashscope-coding-fallback`
멤버가 없기 때문이며, 이번 이동 전후가 동일합니다. 모든 실측은 임시 사본 설정 + `PI_OFFLINE=1`로
돌려 라이브 설정과 네트워크를 건드리지 않았습니다.

## 5. 설치 상태

- `~/.pi/agent/settings.json`: `git:github.com/kijonggong/pi-coding-chain@main`
  (기존 `...pi-openrouter-catalog-filter@main`은 제거, 설정 백업 `settings.json.bak-20261017-020617`)
- 기존 저장소는 이력으로 남고 설치 목록에서 빠졌습니다. 그 저장소의 `package.json`·`README.md`는
  이동 중 실수로 덮어썼다가 `git checkout --`로 원상 복구했습니다.

## 6. 한계와 다음

- `openrouter-catalog-filter`는 체인과 무관합니다 — 별도 패키지로 분리할 수 있습니다.
- 실제 대화형 TUI(피커 화면)는 여전히 스텁 SDK 테스트로만 검증되었습니다.
- 라이브 LiteLLM 설정에는 `sync` 적용이 필요합니다(미해결 결정).

---

## 7. 추가: 피커 행에 라우터 표시 (같은 이름의 모델 구분)

행이 `☐ <모델 id>`뿐이라 **이름이 같은(접두사만 다른) 모델을 구분할 근거가 없었습니다**
(`z-ai/glm-5.3-flash`와 `glm-5.3-flash`는 그룹 이름이 같게 나옵니다). 그래서 행이 어느
라우터의 모델인지 함께 보여줍니다:

- **목록을 읽은 경우**: 고른 업스트림 이름(slug, 없으면 host) — 예 `☐ nvidia/deepseek-v4.1-flash`
- **폴백 목록일 때**: 그 id를 **이미 서비스하는** 업스트림 (둘이면 `·`로 연결) — 예 `☐ explabs·nvidia/glm-5.3-flash`.
  이 id들은 목록이 없어서 설정만이 출처를 말해 줍니다.
- 비교 키는 패키지가 쓰는 정규화(점·대시·대소문자)를 그대로 씁니다.

검증: `catalog.test.ts` 19/19, `picker.test.ts` 10/10, 패키지 전체 **157개 중 155개**(실패 2개는
라이브 설정 드리프트). 실제 SDK(`SelectList`/`Input` + `initTheme`) 렌더 실측:

```
→ ☐ zai/z-ai/glm-5.3-flash        AAII 41.8
  ☐ zai/glm-5.3-flash             AAII 41.8
  ☐ nvidia·explabs/deepseek-v4.1  no AAII score — it would sort last
```

## 8. 추가: ExpLabs 무료 모델 2개 등록 + 빈 체인 허용

요청: "explabs에 muse spark open과 deepseek v4.1 uncensored가 무료가 됨. coding fallback에 추가."

### 8.1 그 "무료"는 리스팅에 없습니다

`/v1/models`(297개)를 그대로 읽으면 둘 다 **유료**입니다: `muse-spark-open` $1.24/$4.24,
`deepseek-v4.1-flash-uncensored` $0.30/$1.20(비-uncensored와 동일). 입력·출력이 모두 0인
채팅 모델은 **0개**입니다. 그런데 실제 호출은 다릅니다:

| 모델 | 1토큰 호출 결과 |
|---|---|
| `muse-spark-open` | **200**, `usage.cost: 0` (provider `wally`) |
| `muse-spark-1.3`, `deepseek-v4.1-flash`, `deepseek-v4-flash` | 429 `insufficient_credits` (잔액 -14.71) |
| `deepseek-v4.1-flash-uncensored` | 502 (Cloudflare, text/plain) — 3회 모두 |

즉 이 계정에서 무료 여부를 말하는 신호는 리스팅의 `pricing`이 아니라 **실제 청구 결과**였습니다.
`muse-spark-open`만 크레딧 0 상태에서도 통과하며 청구가 0입니다. 두 번째 모델은 라우트 자체가
고장나 있어 무료인지 확인할 수 없고, 지금 호출하면 실패합니다(유료 모델의 JSON 429와도 다름).

### 8.2 자동 감지·자동 추가는 있고, 이번 건을 못 봅니다

- 감지: 세션 시작 시 `refreshFreeSnapshot`이 각 업스트림 `/models`를 프로브해 `free-models.json`에
  캐시(`sync`는 `--force`).
- 추가: `sync`/`add` 때 `reconcileFreeEntries`가 `code-free-<slug>-<id>` 그룹을 만들고, `orderChain`이
  그 모델의 티어를 `free`로 올려 체인 앞쪽에 넣습니다.
- **기준이 리스팅 `pricing` == 0**이라 이번 두 모델은 대상이 아닙니다(스냅샷 `free: []`).
  사용자 결정: **감지 기준은 pricing만 유지**(요금 프로브 추가 안 함), 두 모델은 손으로 등록.

### 8.3 라이브 설정이 컴포저를 거부하던 문제

`check`가 계속 `was not understood — no model_list entries match chain "dashscope-coding-fallback"`로
실패했습니다. 10-16에 라이브 설정이 3그룹으로 줄어 `ds-` 멤버가 사라졌고 컴포저는 모든 체인에
멤버를 요구했습니다. 고친 방식:

- `composeCodingFallback`: 멤버가 없는 체인은 **건너뛰고**, 어느 체인에도 속하지 않는 이름만 있으면
  (`no model_list entries match "coding-fallback" or "dashscope-coding-fallback"`) 여전히 거부.
- `chain.test.ts`: 체인 생략 테스트 + "어느 체인에도 안 속하면 거부" 테스트 추가.
- `config.test.ts`: 기존 거부 테스트 2개의 픽스처를 "ds- 없음"에서 "이름이 어느 체인에도 없음"으로
  바꾸고, 손질된(체인 하나뿐인) 설정에 등록이 성공하는 테스트를 추가.

### 8.4 등록 결과

`addModels`(확장의 `add` 경로, 백업 자동)로 1회 쓰기:

```
code-8-explabs-muse-spark-open              model: openai/muse-spark-open
code-9-explabs-deepseek-v4.1-flash-uncensored
coding-fallback: code-2-nvidia → code-4-explabs → code-7-qwen3.8 → code-8 → code-9
```

둘 다 AAII 점수가 없어 **맨 뒤**에 붙습니다(정책: 점수 우선, 미채점은 뒤). 백업
`litellm_config.yaml.bak-2026-10-17T00-23-42-163Z`, `check`는 이후 `up-to-date`,
스냅샷은 `2026-10-17T00:23:32Z`(0 free)로 갱신했습니다.

새 그룹이 `quota-providers`의 "라이브 설정 타깃은 모두 설명되어야 한다" 불변식을 깨서
`EXPLABS.models`에 두 모델을 추가했습니다(`muse-spark-open`은 게시가와 실제 청구가가 다르다는
점을 주석으로 남김).

### 8.5 검증과 한계

- `node --test extensions/` → **160개 중 160개 통과**.
- 한계: ⑴ 무료 판정을 리스팅 가격으로 유지하기로 했으므로 이번 같은 케이스는 계속 수동 등록,
  ⑵ `deepseek-v4.1-flash-uncensored`는 현재 502라 첫 호출이 실패하고 쿨다운됩니다,
  ⑶ 실제 터미널 TUI는 여전히 실사용 확인 전, ⑷ **푸시·설치본 갱신은 사용자 승인 대기** —
  설치본(`e67472e`)은 아직 빈 체인을 허용하지 않아 새 라이브 설정에서 경고를 냅니다.
- 편집이 처음엔 세션 루트인 옛 저장소(`pi-openrouter-catalog-filter`)에 들어가 되돌리고 여기로
  옮겼습니다. 이후 이 저장소에서만 작업합니다.
