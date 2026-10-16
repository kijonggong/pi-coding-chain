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
