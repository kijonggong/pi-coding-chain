# Freebuff2API (Quorinex/Freebuff2API) 보안 검토 보고서

- 조사일: 2026-10-13
- 대상: `https://github.com/Quorinex/Freebuff2API.git`
- 로컬 사본: `_research/Freebuff2API` (shallow clone, 읽기만 수행)
- 조사 방식: 전 소스 정적 분석 + 저장소/도메인 메타데이터 조회. **빌드·실행은 하지 않음.**

---

## 1. 결론

| 질문 | 판정 |
|---|---|
| 저장소 코드가 악성코드인가 | **아니다.** 9개 Go 소스 전체에서 난독화, `os/exec`, 자격증명 탈취, 제3자 전송 코드가 발견되지 않았다. |
| 스캠인가 | **부분적으로 그렇다.** 코드는 정직하지만, README가 "권장" 경로로 안내하는 토큰 발급 사이트가 **Cloudflare에 의해 피싱으로 차단된 도메인**이다. |
| 지금 작동하는가 | **사실상 아니다.** 2026년 6월 이후 업스트림이 비공식 CLI 트래픽을 차단했고(#18), 사용자 계정 정지 보고가 있다(#19). |
| 그대로 배포해도 되는가 | **권장하지 않는다.** 기본 설정에 프록시 인증이 없어(`API_KEYS: []`) 열린 릴레이가 되며(#21, 본 검토에서도 독립 확인), 계정 정지 및 ToS 위반 위험이 있다. |

핵심: **"토큰을 훔치는 트로이목마"는 아니지만, "당신의 계정 토큰을 피싱 사이트로 보내도록 유도하는 배포 채널"이다.** 두 가지는 별개이며, 후자가 실제 위험이다.

---

## 2. 확인된 사실

### 2.1 코드는 깨끗하다 (근거)

검토한 9개 파일: `main.go`, `config.go`, `upstream.go`, `free_session.go`, `models.go`, `run_manager.go`, `server.go`, `token_count.go`, `anthropic.go` (총 112,169 바이트)

| 검사 항목 | 결과 |
|---|---|
| `os/exec`, `exec.Command`, 셸 호출 | **0건** |
| base64/암호화 페이로드, 난독화 문자열 | **0건** (유일한 `base64` 매치는 `anthropic.go:411`의 이미지 data URI 변환 — 정상 기능) |
| `syscall`/`unsafe`/`go:linkname` | `syscall.SIGINT`, `syscall.SIGTERM` 시그널 처리만 (`main.go:63`) |
| 자격증명 파일 탈취 | **0건.** `~/.config/manicode/credentials.json`은 README가 *사람에게* 복사를 지시할 뿐, 코드가 읽지 않는다 |
| 네트워크 목적지 | `cfg.UpstreamBaseURL`(기본 `https://www.codebuff.com`) 및 `raw.githubusercontent.com/CodebuffAI/codebuff/.../free-agents.ts` **단 2곳** |
| 텔레메트리·분석 전송 | **0건** |
| `anthropic.go`(최대 파일, 39.7 KB) | 순수 포맷 변환기. `http.` 매치는 전부 `http.StatusText`/`http.StatusXXX` 상수뿐이며 발신 요청 없음 |
| 의존성 (`go.mod`/`go.sum`) | 3개, 전부 주류 라이브러리: `dlclark/regexp2`, `google/uuid`, `tiktoken-go/tokenizer` |

**코드가 접속하는 곳은 Codebuff 공식 서버와 Codebuff 공식 GitHub 저장소뿐이다. README가 안내하는 `llm.pm`은 소스 코드 어디에도 등장하지 않는다**(`rg -i 'llm\.pm'` → README 2건, 소스 0건). 즉 토큰 유출 경로는 *코드가 아니라 사람을 향한 안내문*에 있다.

### 2.2 그런데 그 안내문이 피싱 사이트를 가리킨다 (핵심 위험)

README `Method 1 — Web (Recommended)`:

> Visit **https://freebuff.llm.pm**, log in with your Freebuff account, and your auth token will be displayed directly on the page.

이 도메인을 브라우저로 열면 Cloudflare가 차단 페이지를 반환했다:

- 페이지 제목: `Suspected Phishing | Cloudflare`
- 본문: "Warning / **Suspected Phishing** / This website has been reported for potential phishing. Phishing is when a site attempts to steal sensitive information by falsely presenting as a safe source."
- Cloudflare Ray ID: `a49e85d4e8ae9aea`

추가 도메인 정보:

| 항목 | 값 |
|---|---|
| DNS | `172.67.220.21`, `104.21.38.76` (Cloudflare) |
| 등록일 | 2025-09-10 (RDAP handle `DOM102520479-FRNIC`) |
| 만료 | 2027-09-10 |
| 최종 변경 | 2026-09-11 |
| 등록자 | `ANO00-FRNIC` — **AFNIC 익명 등록자 핸들(실소유자 비공개)** |
| Codebuff 공식 여부 | **아님.** Codebuff 공식 도메인은 `codebuff.com`. 해당 사이트는 "로그인 URL을 열고 콜백 URL을 붙여넣으면 토큰을 보여준다"는 구조로, **Codebuff 계정 토큰을 페이지에 입력하게 만든다.** |

저장소 작성자 `Quorinex`는 계정 생성 2026-01-29, 공개 저장소 3개, 팔로워 16명, 이름·소개·블로그 미설정이며, 이 도메인과의 소유 관계는 확인되지 않는다.

### 2.3 저장소 지표 (참고 — 안전성 지표가 아님)

| 항목 | 값 |
|---|---|
| 스타 / 포크 / 워처 | 738 / 117 / **2** |
| 생성 / 최종 푸시 | 2026-04-18 / **2026-04-22** (약 6개월 정체) |
| 커밋 수 | 12 |
| 열린 이슈 | 7 |
| 라이선스 / 크기 | MIT / 54 KB |

### 2.4 이슈 트래커가 알려주는 실제 운명

| 이슈 | 날짜 | 제목 | 의미 |
|---|---|---|---|
| **#19** | 2026-06-13 | "account is getting banned" | **사용자 Codebuff 계정이 실제로 정지됨** |
| **#18** | 2026-06-10 | "Upstream Codebuff free tier blocks non-freebuff CLI requests and VPN/proxy traffic" | **업스트림이 비공식 클라이언트를 차단 → 사실상 작동 불가** |
| **#21** | 2026-08-31 | "Default empty API_KEYS makes Docker deployment an open relay for configured auth tokens" | 본 검토에서 독립적으로 찾아낸 결함과 일치 |
| #11 | 2026-04-22 | (PR, 병합) "fix: disable banned tokens and handle session resets" | 정지된 토큰 처리 로직이 이미 필요했음 |
| #15 | 2026-05-14 | "URL contains auth_code but it could not be parsed" | 토큰 발급 페이지 관련 불안정 |

repo는 2026-04-22 이후 사실상 방치 상태이며, 마지막 커밋이 6개월 전이다. README가 그대로여도 **실제로는 이미 깨진 프로젝트**다.

---

## 3. 코드 구조상의 위험 요소 (악성코드와 별개)

1. **기본 무인증 노출 — 가장 심각**
   `config.example.json`과 README의 Docker 예시 모두 `API_KEYS`를 비워 둔다. `server.go`의 `withMiddleware`는 `len(s.cfg.API_KEYS) > 0`일 때만 인증을 걸므로, **기본값에서는 포트 8080에 닿는 누구나 당신의 Codebuff 토큰으로 추론을 돌릴 수 있다.**
   같은 이유로 `/healthz`가 인증 없이 열리며, `token_state`에 세션 인스턴스 ID·쿨다운·마지막 오류가 그대로 노출된다(`run_manager.go`의 `tokenSnapshot`).

2. **다중 계정 토큰 로테이션**
   README: "Log in with multiple accounts and configure all their tokens for higher throughput." 다중 계정 운영은 통상 서비스 약관 위반이며, 계정 정지(#19)의 직접적 원인 후보다.

3. **탐지 회피 지향 설계**
   README의 "Stealth Request Handling — Dynamic, randomized client fingerprints that mimic official Freebuff SDK behavior". 코드에서도 `generateUserAgent()`가 `ai-sdk/openai-compatible/1.0.25/codebuff`로 **공식 SDK인 척 위장**하고, `generateClientSessionId()`가 매 요청 세션 ID를 위조한다(`config.go`).

4. **검증 불가한 사전 빌드 이미지**
   README는 `ghcr.io/quorinex/freebuff2api:latest`를 안내한다. 공개 바이너리의 소스 일치 여부는 이 환경에서 검증 불가(Docker 미설치). 소스가 깨끗하다는 사실이 **이미지가 깨끗하다는 것을 보장하지 않는다.**

5. **토큰 취급 방식**
   토큰은 `config.json` 또는 환경변수로 다뤄진다. Docker 환경변수는 `docker inspect`로 노출된다.

---

## 4. "작동하는가"에 대한 정직한 답

**빌드도 실행도 하지 않았다.** 확인하지 않은 것을 확인했다고 말하지 않기 위해 명시한다.

- 컴파일 가능성: 이 환경에 Go 1.26.5가 있어 요구사항(1.23+)은 충족한다. 소스는 문법적으로 일관돼 보이나, **컴파일 성공은 기능 정상 동작을 의미하지 않는다.**
- 실제 동작 확인이 불가능한 이유: 요구되는 `AUTH_TOKENS`는 Codebuff 계정 자격증명이다. 이를 얻는 경로는 (a) 피싱으로 차단된 제3자 사이트, 또는 (b) Codebuff CLI 자격증명 파일에서 직접 추출하는 방법뿐이다. 어느 쪽도 검증 목적으로 수행하지 않았다.
- 독립적 증거로 본 동작 여부: **이미 깨졌다.** 이슈 #18(업스트림 차단), #19(계정 정지), 그리고 2026-04-22 이후 커밋 중단이 이를 뒷받침한다.

---

## 5. "내 전용으로 만들어줘" 요청에 대한 처리

**수행하지 않는다.** 사유:

1. 이 소프트웨어의 동작 원리 자체가 **제3자 서비스의 접근 통제를 우회**하는 것이다 — 공식 SDK 지문 위조, 세션 유지용 강제 로테이션, 무료 티어 한도 우회, "계정 여러 개로 처리량 상향". 이는 개인정보 보호 문제가 아니라 회피 인프라 구축이다.
2. 토큰을 확보하는 유일한 실용 경로가 **Cloudflare가 피싱으로 신고·차단한 도메인**이다.
3. 순수 실용성으로 봐도 **손해다.** 이미 차단됐고, 계정이 정지된다. 전용 배포를 만드는 시간이 곧바로 사라질 코드에 들어간다.
4. 아울러 계정 정지·ToS 위반은 **사용자 본인**이 부담한다.

관련 파일 사본 `_research/Freebuff2API`는 읽기 전용 증거로 남겨 둔다. 삭제를 원하면 말해 달라 — 파괴적 작업이므로 확인 후 진행한다.

---

## 6. 대안

같은 목적("OpenAI 호환 엔드포인트로 무료 모델 사용")을 우회 없이 달성하는 정당한 경로:

1. **OpenRouter 무료 티어** — 이미 이 워크스페이스의 `pi-openrouter-catalog-filter` 프로젝트가 정확히 이 계층(`:free` 모델 15종)을 다룬다. 신규 우회 채널 대신 이 기존 경로를 유지·확장하는 편이 안전하고 지속 가능하다.
2. **공식 무료/저가 티어** — Google AI Studio(Gemini 무료 등급), Groq, Cerebras 등은 OpenAI 호환 엔드포인트를 **공식적으로** 제공한다. 약관 위반도, 지문 위조도, 토큰 피싱도 필요 없다.
3. **정말로 Codebuff를 쓰고 싶다면** 공식 CLI(`npm install -g codebuff`)를 직접 쓰는 것이 유일한 정당한 경로다. 토큰을 제3자에게 넘길 필요가 없다.

---

## 7. 요약 (한 줄)

코드는 악성코드가 아니지만, **토큰을 피싱 신고된 사이트로 넘기도록 유도하는 이미 작동하지 않는 우회 도구**이며, 기본 설정이 무인증이라 그대로 배포하면 계정을 헌납하게 된다.
