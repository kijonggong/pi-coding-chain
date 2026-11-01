# 처분 기록 — Magpie routing 채택 기능 (groups·strategy·affinity·explain·에스컬레이션)

작성일: 2026-10-31 · 정본 검증 절차 3단계
입력: Iron Laws `_research/iron-laws-groups.json` (17건) · 독립 리뷰 (11건, 세션 산출물
`e433967b`) · mutation check `_research/mutation-groups.md` (18변이: 16 kill / 2 survive) ·
코디네이터 의심 메모 `_research/coordinator-notes-groups.md` (8건)

## 처분표

| ID | 출처 | 지적 | 처분 |
|---|---|---|---|
| R-P0-1 | 리뷰 | rotate에서 retry가 실패한 턴과 다른 순서를 걸어 남은 후보가 있어도 "chain exhausted"로 턴 실패 (index.ts:784, 855-862, strategy.ts) | **수정** — retry는 저장된 `turns`에서 1을 되돌린 상태로 전략 순서를 재계산해 실패한 턴의 순서를 걷는다. 실제 저장 state를 재주입하는 index.test.ts 재현 시험으로 잠근다(P2-1 시험 교체) |
| C-2 | 코디네이터 #2 | `state.strategyName`이 설정보다 우선해 세션 중 전략 변경이 반영되지 않음 (index.ts:772, 834). 작업 지시서의 내 지시가 출처 — **지시 오류** | **수정** — strategyName 필드·읽기·쓰기 제거(2.5, 소비자 없음). 전략은 매 요청 group+settings에서 결정. epoch bump와 함께 전략 변경이 즉시 반영된다 |
| R-P1-1 | 리뷰 | `DecisionReason` 타입 import 누락 — 타입 검사 계약 깨짐 (index.ts:793) | **수정** — `import type` 한 줄 |
| R-P1-2 | 리뷰 | groups 부분 거부 note가 대화형 경로(설정 창 dialog, `set`)에서 삼켜짐 (index.ts:441-447, 644-651; settings.ts는 이미 `notes` 반환 — 직접 확인) | **수정** — 두 호출 지점에서 `edited.notes`를 notify |
| R-P2-1 | 리뷰 | rotate retry 시험이 입력 state를 재주입해 실제 생산자→소비자 연결이 아님 | **수정** — P0-1 수정과 함께 index.test.ts의 실제 연결 시험으로 교체 |
| R-P2-2 / C-1 | 리뷰+코디네이터 #1 | explain.ts `consideredList`의 죽은 `chosen` 매개변수, 읽는 곳 없는 `when` 필드, `lastDecision` 주석 부정확 | **수정** — 매개변수·필드 제거, 주석 교정. index.ts 호출부 함께 |
| R-P2-3 / 작업자 보고 | 리뷰 | 등록 팩토리 재검증 루프·`registrationNotes` 도달 불가(항상 빈 배열) — 2.7 과잉 방어. 출처: 작업 지시서의 내 이중 검증 요구 — **지시 오류** | **수정** — 루프·필드 제거, `parsed.settings.groups`를 그대로 등록 |
| R-P2-4 | 리뷰 | least-used가 fresh turn만 집계 — 설계 §3("실제 응답한 후보를 센다") 불일치 | **수정** — retry·continuation 반환 전 실제 응답자 `recordServed` |
| R-P2-5 | 리뷰 | README·설계가 주장하는 rotate 인덱스 note가 구현에 없음 | **수정** — applyStrategy rotate 분기에 오프셋 note 추가(문서를 실제와 일치시키는 방향은 문서가 옳았음) |
| R-P2-6 | 리뷰 | routingChanged groups 비교가 JSON.stringify 키 순서에 민감 — 같은 내용 저장에 epoch 오상승 | **수정** — id 기준 정렬·정규화된 내용 비교 (M9 시험 유지) |
| R-P2-7 | 리뷰 | index.ts `preferred` 미사용 import, containsImage 이중 계산 | **수정** — 각 한 줄 |
| IL-TYP-301 | Iron Laws | groups.ts:115 `group.match!` non-null 단언 (신규) | **수정** — 지역 변수 추출로 narrowing, 단언 제거 |
| IL-ARC-205 | Iron Laws | 'least-used' 문자열 2파일 4곳 중복 (신규) | **수정** — settings.ts가 strategy.ts의 `STRATEGIES`를 재사용(단일 출처), reason 문구도 파생 |
| R-P2-8 / M-E3 / M-E8 | 리뷰+mutation | 시험 겹: per-group strategy/affinity override 미검증, coolingDescriptions 정렬 무방비, free-first 동점 tiebreak 도달 불가 | **수정** — index.test.ts override 시험, explain.test.ts 정렬 시험, strategy.test.ts 동점 fixture 추가 후 사본에서 E3/E8 변이 재실행해 kill 확인 |
| IL-IL-307 | Iron Laws | parseDuration/parseToggle "조건 실패 시 기본값 반환" (settings.ts:232-245, 기존) | **기각(근거)** — undefined 반환은 계약의 일부이고 호출부가 note로 보고한다(settings.test.ts가 note 문구 단정). 도구의 "조용한 기본값" 판정은 undefined 반환의 오독 |
| IL-IL-301a | Iron Laws | parseSettings JSON catch (settings.ts:399, 기존) | **기각(근거)** — note 문자열로 보고되며 시험이 단정("reports what a file said that could not be used") |
| IL-IL-301b | Iron Laws | parseGroupsValue JSON catch (settings.ts:306, 신규) | **기각(근거)** — rejected 사유로 반환되어 editSetting이 ok:false로 전달, 시험 단정 |
| IL-PERF-102 | Iron Laws | parseModelEntries/parseOrigins includes 루프 (기존, 이번 미변경) | **부채 기록(하)** — 연산자 설정 목록(수십 개 이하) 경계. 분리는 부채 목록으로 |
| IL-AI-101 | Iron Laws | candidates.ts:62 고정 URL (기존, 이번 미변경) | **기각(근거)** — 의도된 기본값(README 문서화: LiteLLM 프록시 기본 제외) |
| IL-ARC-201 | Iron Laws | index.ts 879줄·routeFor 121줄·handler 126줄, settings.ts 675줄 (기존 초과가 커짐) | **부채 기록(중)** — 파일 분할은 구조 변경으로 별도 계획·사용자 승인 대상(스킬 T3). 이번 변경에서 확장·신설한 함수 단위 분할은 보류 |
| M-E3 | mutation | coolingDescriptions 임박순 정렬 무방비 | 위 시험 보강 항목으로 **수정** |
| M-E8 | mutation | free-first 동점 tiebreak 무방비 | 위 시험 보강 항목으로 **수정** |
| C-3, C-4 | 코디네이터 #3·#4 | retry 상태 보존, takeHead slice 우회 | **확인 완료** — 작업자가 수정 완료(index.ts:866 주석·recordServed). 기각 |
| C-5 | 코디네이터 #5 | settings 비문자열 배열 처리 | **확인 완료** — JSON.stringify 경유 후 groups는 검증, 타 키는 note 거부. 기각 |
| C-6 | 코디네이터 #6 | 비동기 팩토리 읽기 오류 전파 | **확인 완료** — loadSettings가 ENOENT만 없음 처리, 나머지 전파(확장 로드 실패 = 가시). 기각 |
| C-7 | 코디네이터 #7 | groups env 우선순위 | **확인 완료** — resolveSettings env 루프가 공용 경로. 시험 있음. 기각 |
| C-8 | 코디네이터 #8 | 이전의 실패 2개(라이브 드리프트) | **해소** — 현재 280/280 |

## 진행
- 위 "수정" 항목을 작업자에게 파일 소유 지시해 반영 → 시험·grep·Iron Laws 재실행으로 직접 확인 → 새 세션 재리뷰 → 완료 정의 판정.
- workflow 스크립트 비고: 검증 레인의 `runs.all`에 run 핸들을 재전달해 "Duplicate workflow key" 스크립트 오류로 종료 — **두 자식은 완료**·산출물 회수 완료. 재실행 불필요(작성 실수, 기록용).

## 2차(재검토 뒤) 처분 — RE-REVIEW PASS (차단 0 · 보완 필요 3 · 사소 4)

재검토 보고: `_research/rereview-groups.md`. 1차 수정 13항목 전부 해소 코드 대조 확인. 2차 처분:

| ID | 지적 | 처분 |
|---|---|---|
| R2-F1 | least-used의 stick→recordServed 배선이 시험에 잠기지 않음 (회귀 무방비) | **수정 완료** — index.test.ts least-used 통합 시험 + 사본 변이(stick 호출 제거) kill 확인 |
| R2-F2 | 세션 중 전략 변경 반영(C-2의 실제 계약) 시험 부재 | **수정 완료** — index.test.ts `set strategy rotate` 회전 시험 + 사본 변이(전략 읽기 제거) kill 확인 (4 fail) |
| R2-F3 | WORKLOG가 참조하는 작업자 보고 파일 부재 (2.11) | **수정 완료(코디네이터)** — `groups-impl-report.md`·`fix-report-groups.md`·1차 리뷰(`review-groups-independent.md`)·재검토 보고를 `_research/`에 저장, 참조 유효화 |
| R2-F5 | coolingDescriptions가 coolingLabels의 임박순 규칙을 사본으로 둠 (2.4) | **수정 완료** — coolingLabels에서 파생, E3 시험 무수정 통과(단일 출처 잠금) |
| R2-F6 | dialog 경로 groups note 시험 갭, 키/배열 순서 독립 단정 부재 | **수정 완료** — 2시험 신설(총 291 pass) |
| R2-F7 | routingChanged가 표시 전용 name도 비교 — rename 시 epoch 상승 효과 미문서 | **수정 완료(문서)** — 비교에서 name 제외 대신 확장 README에 효과 명시 + F6(b) 시험이 결정 잠금 |
| R2-F4 | retry 되감기의 turns: 0 → 음수 오프셋 잠재 경로 (현재 도달 불가) | **관찰 기록(수정 불요)** — 재검토 판정: 방어 추가는 2.7 과잉 방어. 외부 도구가 state를 손으로 쓰는 경우만 해당 |

2차 검증: 시험 291/291(코디네이터 직접 재현), Iron Laws final 15건(2차 라운드 신규 0건, `iron-laws-groups-final.json`), mutation E3/E8/F1/F2 전부 kill.

## 완료 정의 (2.10 4단계) — 2026-10-31 판정, 11-01 실물 검증으로 갱신
1. **소스·import·빌드 성공** ✅ — node --test 291/291 (type-stripping import 전 경로), Iron Laws scan complete.
2. **대역 통합** ✅ — 시험 하네스는 패키지 경계(SDK)만 대역, 제품 코드에 시험 전용 경로 없음(독립 리뷰 1차+재검토 확인).
3. **사용 가능한 실물 증거** ✅ **(11-01 RPC 실측)** — pi 1.4.0 `--mode rpc --no-extensions -e <작업트리>`로 실제 요청 소비(총 8턴):
   - 실제 응답한 물리 모델이 턴마다 바뀜: `fallback/aaii` + rotate/turn 전략에서 턴1 `magpie/auto/glm-5.3-flash` → 턴2 `magpie/nvidia/z-ai/glm-5.3-flash` (rotation 진행, `rpc-a-run-a.jsonl`).
   - family 그룹 단축: `fallback/glm-5.3-flash`의 explain order가 후보 42 → **glm family 7개**로 걸림, 전원 family 멤버 (`rpc-a-run-b.jsonl`).
   - manual 전략: pin만 걷고 pin 밖은 제외 — order에 pin 2개만 (`rpc-a-run-d.jsonl`).
   - **실물 폴백 + 실패 기억**: 격리 agent dir(죽은 로컬 provider `aaii-live-dead`를 pin 선두)에서 연결 실패 → `retry after failure`로 다음 후보에 폴백 → 실패 후보 `cooling 5m, error`로 보고/상태 반영 (`rpc-a-run-g.jsonl`).
   - explain은 fresh turn·retry·실패 후보·considered 목록을 실제로 기록·보고했고, 결정 없을 땐 `no routing decision yet`을 말함.
   - 실측 원문: `_research/rpc-a-run-{a,b,d,g}.jsonl` (민감 패턴 스캔 0건).
4. **실물 준비 완료** ⚠️ — 푸시·설치본 갱신은 사용자 승인 대기(기존 관례).
