# W1 수정·검증 보고

정본: `docs/engineering-standard.md` 전체와 `_research/standard-disposition-iron-laws.md`를 읽고 W1 수정 항목만 처리했다. 커밋·stash·reset·checkout·기존 변경 원복을 하지 않았으며, 네트워크와 사용자 agent 설정 파일을 사용하지 않았다. 실제 사용자 LiteLLM 설정은 읽거나 쓰지 않았고 파일 입출력 시험은 시스템 임시 디렉터리의 fixture만 사용했다.

## 표준 4절 보고 점검표

- [x] 책임 소유와 구조: coding-fallback/scores.ts가 점수 파일 읽기와 기본 경로·환경 변수 해석을 소유하고, config 및 두 확장 진입점이 같은 계약을 소비한다. providers.ts가 URL 파싱을 소유하고 candidates·settings·chain이 결과의 의미를 결정하며, free-models.ts의 ExpLabs 주소를 quota catalog가 가져온다.
- [x] 더한 것 / 뺀 것: 경로를 담은 읽기 오류, 실패 전파·거부, 색인 레코드 진단, 단일 URL 파서와 경로 해석, 경계 회귀 시험 및 README 설명을 더했다. 중복 host/origin/점수 경로 함수, cwd 대체, 별칭 JSON 오류 삼키기, 두 setStatus try/catch와 optional chain, picker의 non-null 단언을 지웠고 모든 호출 지점을 함께 변경했다.
- [x] 3절 형태와 정당성: URL 파서는 외부 URL 입력을 해석하는 실제 책임 경계이며 기존 세 곳의 파싱을 대체한다. config의 catch는 loadScores 오류를 기존 공개 결과 `{ error }`로 변환하는 파일 작업 책임이며, 별칭 읽기의 catch는 ENOENT 구별과 CLI 경로·원인 보고만 수행한다. 대역은 fetch·SDK 패키지·UI 경계에만 있다.
- [x] 실제 역할·소비자와 재사용 근거: scores.ts의 resolver를 coding-fallback index, aaii-router registry 및 fetch CLI가 소비한다. providers.ts 파서는 체인의 hostname 분류와 라우터의 제외 origin 비교에 사용되며 settings는 그 위에 http(s) 허용 검사만 둔다. 새 시험 전용 export/hook은 없다.
- [x] 시험 계약과 mutation: 아래 표와 `w1-mutation-results.json`에 기록했으며 임시 복사본에서 16개 변이를 모두 검출했다. 최종 원본 작업 트리 시험은 212 pass / 0 fail / 0 skipped다.
- [x] 임시 코드와 제거 조건: 제품 임시 코드는 없음. 일회성 mutation 실행 스크립트는 실행 후 삭제했고 결과 JSON만 남겼다.
- [x] 동작 보존 / 의미 변경: 아래 별도 항목에 구분했다.
- [x] 리뷰 처분 위치: 이번 정적 분석 관측은 `iron-laws-w1-after.json`과 아래 항목에 있으며 최종 처분은 총괄이 수행한다; 기존 기각 근거는 `standard-disposition-iron-laws.md`다. 독립 재리뷰와 기존 대화의 GPT Pro 재리뷰는 총괄이 수행할 후속 단계로 아직 완료하지 않았다.

## 수정 처분

| 항목 | 결과 |
|---|---|
| IL-28 + IL-35 / D1 | 기존 점수 파일 ENOENT만 빈 별칭으로 시작한다. 읽기 오류·JSON 구문 오류는 fetch 전에 경로와 이유로 중단해 파일을 보존한다. aliasMapsFromSnapshot은 JSON 오류를 던진다. |
| IL-27 | 읽기에 실패해 건너뛴 원격 색인 파일과 오류 메시지를 stderr에 출력한다. |
| IL-34 / D2 | loadScores의 빈 표 반환을 ENOENT에 한정한다. config check/sync/add는 오류 결과로 거부하고 백업·쓰기를 하지 않는다. coding-fallback 점수 조회와 aaii-router registry/route는 오류를 전파한다. |
| IL-32 / D3 | fileURLToPath의 try/catch 및 cwd 대체를 삭제했다. |
| IL-16 + C-3 | scores.ts의 resolveScoresPath를 공유하며 라우터의 scoresPath·extensionDir 및 다른 확장 디렉터리 배치 지식을 삭제했다. |
| IL-03 + IL-07 + C-1 | ExpLabs base URL은 free-models.ts에 한 번 정의하고 quota catalog가 import한다. |
| IL-19 + IL-20 + IL-23 + IL-26 + C-2 | providers.ts의 parseProviderUrl로 URL 파싱을 통합했다. 후보의 파싱 실패는 출처 없음, 체인은 빈 host(미분류), 설정은 거부 사유로 해석한다. |
| IL-21 + IL-22 | setStatus를 SDK 계약대로 직접 호출하며 headless no-op 계약을 유지한다. |
| IL-25 | readSettingsFile은 ENOENT만 undefined로 반환하고 다른 오류는 경로·이유와 함께 던진다. |
| IL-49 | get 결과를 지역 변수로 검사해 단언 없이 동일 선택 결과를 만든다. |

## 의미 변경

1. 깨지거나 읽을 수 없는 점수 파일은 더 이상 빈 점수표로 간주하지 않는다. 특히 aaii-router가 tier 순서로 조용히 라우팅하던 경우 이제 registry 구성과 route가 실패한다. coding-fallback 조회도 실패하고 check/sync/add는 원인을 보고하며 쓰기를 거부한다. ENOENT의 기존 빈 표 계약은 유지했다.
2. fetch-scores는 기존 별칭 파일의 읽기·JSON 오류 시 중단하고 기존 파일을 보존한다. 원격 레코드 읽기 실패는 건너뛴 파일과 이유를 출력한다. 공유 경로 resolver를 사용하므로 `--out`이 없으면 CLI도 `PI_CODING_FALLBACK_SCORES`를 따른다.
3. 설정 파일의 ENOENT 이외 읽기 오류가 더 이상 기본값으로 감춰지지 않는다. 깨진 설정 JSON의 note·기본값 계약은 기존 처분대로 유지했다.

URL 정규화·ExpLabs 주소·점수 기본 경로의 통합, 도달 불가능한 cwd 대체 제거, SDK 상태 호출 정리, picker 단언 제거는 유효 입력에서 동작 보존이다. 이 정리 자체에 “수정 전 실패”를 주장하지 않는다. 보존 계약을 일부러 깨는 변이로 회귀 검출력을 확인했다.

## 시험과 변이

| 시험 경계와 계약 | 주입한 변이 / 결과 |
|---|---|
| scores.test.ts: malformed 별칭 JSON은 실패한다 | JSON 실패를 빈 별칭으로 대체 / 검출 |
| fetch-scores.test.ts: 읽기 오류는 별칭 보존 단계에서 중단하고 기존 파일을 보존한다 | 모든 read 오류를 없음으로 간주 / 검출 |
| fetch-scores.test.ts: 실제 CLI가 missing 파일 생성·별칭 보존·실패 파일 진단을 수행한다 | 레코드 stderr 진단 삭제 / 검출 |
| scores.test.ts: ENOENT만 빈 표이고 malformed·디렉터리 읽기는 경로와 이유로 실패한다 | 모든 read 오류를 빈 표로 대체 / 검출 |
| index.test.ts: registry 보고 및 route는 손상 점수표로 후보를 고르지 않는다 | malformed를 빈 표로 대체 / 검출 |
| config.test.ts: corrupt·unreadable 점수표를 오류 결과로 거부하고 백업·설정 쓰기를 하지 않는다 | config catch에서 오류 재전파 / 검출 |
| picker.test.ts: 실제 add 명령 점수 조회가 default 파일의 87점을 사용하고 손상 시 실패한다 | default를 cwd 상대 파일로 변경 / 검출 |
| scores.test.ts 및 router index.test.ts: 모듈 기준 default·환경 변수 override를 공유한다 | 환경 변수 무시 / 검출 |
| quota catalog.test.ts 및 free-models.test.ts: 두 실제 소비자가 ExpLabs v1을 사용한다 | 원 출처 주소를 잘못된 주소로 변경 / 검출 |
| candidates.test.ts: 설정 origin과 후보 URL이 포트를 포함해 같은 정규화를 쓴다 | origin에서 port 삭제 / 검출 |
| chain.test.ts: hostname으로 분류하고 invalid URL을 미분류로 남긴다 | hostname 대신 port 포함 host 사용 / 검출 |
| candidates.test.ts 및 providers.test.ts: 파싱 실패는 undefined이고 후보는 미분류로 남는다 | invalid URL에 throw / 검출 |
| settings.test.ts: read/load의 non-ENOENT 파일 오류가 드러난다 | 모든 read 오류를 undefined로 대체 / 검출 |
| router index.test.ts: session 시작은 status를 지우고 route는 선택 모델을 표시한다 | 표시 호출 삭제 / 검출 |
| 같은 status 시험: session 시작의 상태 초기화 계약 | session clear 호출 삭제 / 검출 |
| picker.test.ts 기존 선택 계약: 표시 순서대로 선택 객체를 반환한다 | 선택 객체 반환 삭제 / 검출 |

수락 명령: `PI_OFFLINE=1 PI_CODING_FALLBACK_FREE_REFRESH=off node --test extensions/aaii-router/*.test.ts extensions/coding-fallback/*.test.ts extensions/quota-providers/*.test.ts` (PowerShell에서 환경 변수를 먼저 설정). 최종 결과 212 pass / 0 fail / 0 skipped, git diff --check 통과. 실제 네트워크·Pi 런타임에서의 라이브 라우팅은 이번 오프라인 시험 범위 밖이며, 성공 증거는 파일·SDK/UI 대역 통합까지다.

## Iron Laws 재실행 관측 — 최종 처분은 총괄 소유

`iron-laws audit . --format json -o _research/iron-laws-w1-after.json`: 70 files, 37 findings, D, scan complete, suppressed 0. 이 실행 시점의 W2 미수정 내용도 전체 결과에 포함되므로 등급을 W1 완료 여부로 사용하지 않았다. 총괄의 후속 지시에 따라 새 지적과 W1 배정 항목 중 남아 표시되는 지적만 보고하며, 기존 처분 파일은 수정하지 않았다.

| 파일:줄 | 규칙 | 분류와 남아 표시되는 이유 |
|---|---|---|
| extensions/coding-fallback/providers.ts:116 | IL-307 | 새 공유 파서의 undefined 입력 처리이며 C-2에 명시된 파싱 API 계약이다. 호출자가 출처 없음·미분류·설정 거부로 해석한다. |
| extensions/coding-fallback/providers.ts:120 | IL-301 | 배정된 IL-19/20/23/26의 중복 try/catch를 삭제한 뒤 소유 책임에 하나 남긴 URL 파싱 catch다. 잘못된 URL을 undefined로 돌려주는 C-2의 의도된 parse API 계약이라 남아 표시된다. |
| extensions/coding-fallback/free-models.ts:58 | AI-101 | IL-03/07/C-1의 주소를 단일 이름 붙은 정의로 옮긴 뒤 그 공개 고정 API 주소 한 곳이 계속 표시된다. free probe와 quota native catalog가 import해 소비하므로 중복 정의는 없다. |

그 밖의 W1 배정 수정 항목은 재실행 결과에 남지 않았다. 위 계약 근거는 작업자 설명이며 최종 수정/기각 판정은 총괄에 남긴다.

총괄 후속: 이 보고 및 현재 diff에 대한 독립 재리뷰, 기존 대화 GPT Pro 재리뷰와 지적 처분, 두 작업자 결과가 합쳐진 최종 확인.
