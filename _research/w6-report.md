# W6 — RR-01 · RR-03(aaii) · RR-04 · RR-07

## 범위와 선행 확인

`engineering-standard` 스킬을 `C:/Users/airgu/.agents/skills/engineering-standard/SKILL.md`에서 불러왔고, 그 `references/standard.md`, 저장소 `docs/engineering-standard.md`를 전부 읽었다. `_research/standard-disposition-iron-laws.md`의 재리뷰 반영 절과 `_research/standard-rereview-iron-laws.md`를 읽고 해당 처분을 구현했다. 시작 시 이미 여러 확장과 정본에 미커밋 변경 및 조사 파일이 있었다. 그 변경을 되돌리지 않았으며 아래 수정과 요청받은 이 보고서만 작성했다.

제품·시험 수정 파일: `extensions/aaii-router/index.ts`, `index.test.ts`, `settings.test.ts`, `README.md`. 소유 범위의 `settings.ts`는 수정할 필요가 없었다. 커밋·stash·reset·checkout·revert, 네트워크·유료 호출 및 금지된 개인 설정 파일 접근은 하지 않았다.

## 항목별 처분

| ID | 처분과 근거 |
|---|---|
| RR-01 | 수정. `currentSettings`의 untrusted 분기에서 설정 읽기를 제거하고 `lstat`으로 경로 존재만 확인한다. 디렉터리와 심볼릭 링크도 내용을 읽거나 링크 대상을 따라가지 않고 ignored note로 알린다. ENOENT는 종전처럼 노트 없이 지나가고, 그 밖의 존재 확인 오류는 원인을 포함한 ignored note로 보고하면서 라우팅을 계속한다. global·trusted project의 `loadSettings` 호출과 오류 전파는 그대로다. README에 이 경계를 명시했다. |
| RR-03(aaii) | 수정. 네 호출자 모두 메시지를 전달하므로 `infoMessage`를 필수 문자열로 바꾸고 `if (infoMessage)`를 삭제했다. |
| RR-04 | 수정. `openFallbackEditor`의 읽히지 않는 `const edited =`만 삭제하고 `await`을 유지했다. |
| RR-07 | 수정. 중복된 `editSetting accepts expanded…` 시험을 삭제했다. 기존 vision 매핑 단정은 유지하고 status 매핑 단정 하나만 기존 `validates one setting at a time…` 시험으로 합쳤다. 어휘와 오류 문구는 각각 기존 시험 한 곳에서만 검사한다. |

## 수락과 mutation

수락 명령:

```powershell
$env:PI_OFFLINE='1'; $env:PI_CODING_FALLBACK_FREE_REFRESH='off'; node --test extensions/*/*.test.ts
```

결과: **234 pass / 0 fail / 0 skip / 0 cancelled**. 기존 233개에서 새 통합 시험 2개를 더하고 중복 시험 1개를 삭제했다. 관측한 최종 실행에서 다른 작업자 확장의 일시 실패는 없었다. 수정 파일의 `git diff --check`도 통과했다.

| 시험 | 지키는 계약 한 줄 | 관측 |
|---|---|---|
| 새 untrusted directory 통합 시험 | 신뢰하지 않는 `.pi/aaii-router.json`이 디렉터리여도 전역 설정으로 라우팅하고 보고에 ignored 경고가 나온다. | 실제 임시 디렉터리를 만들고 전역 pin `three/c` 선택과 trust note를 확인한다. |
| 새 existence-check error 통합 시험 | 신뢰하지 않는 경로 존재 확인이 EACCES로 실패해도 기본 라우팅을 유지하고 보고에 경로·이유를 남긴다. | 파일 I/O 경계 `lstat`만 EACCES 대역으로 바꾸고 `one/a` 선택과 이유를 확인한 뒤 대역·builtin ESM 바인딩을 복원한다. |
| 기존 unreadable settings 통합 시험 | 읽어야 하는 전역 설정이 디렉터리이면 라우팅과 보고 모두 읽기 오류를 드러낸다. | 종전 EISDIR 거부 계약 그대로 통과한다. |
| 기존 validates-one-setting 시험 | 개별 편집은 해당 설정에 매핑되고 유효하지 않은 값은 이유와 함께 거부된다. | status 매핑 한 단정을 통합했고 기존 오류 단정을 유지했다. |

일회 mutation은 작업 트리 밖 임시 사본에서 수행했다. 같은 index/settings 시험의 사본 기준선은 **38 pass / 0 fail / 0 skip**, 종료코드 0이었다. 사본에서 untrusted 분기를 다시 `readSettingsFile` 호출로 바꾸자 **36 pass / 2 fail / 0 skip**, 종료코드 1로 변이가 검출됐다. directory 통합 시험은 `cannot read settings … EISDIR`로 실패하고 existence-check 오류 보고 시험도 실패했다. 사본은 정리했으며 작업 트리 제품 소스에는 변이를 적용하지 않았고 상주 소스 치환 시험도 추가하지 않았다.

## 정본 4절 점검표

- [x] 책임 소유와 구조: `index.ts/currentSettings`가 프로젝트 신뢰 경계를 소유한다. 신뢰된 설정 해석·읽기는 기존 `settings.ts/loadSettings`에 남기고 무시 대상의 존재 진단만 분리했다(2.1, 2.6).
- [x] 더한 것 / 뺀 것: lstat 존재 확인·원인 note·통합 시험 2개·문서 설명을 더했다. untrusted 설정 읽기, 선택 메시지 분기, 사용하지 않는 편집 결과 바인딩, 중복 토글 시험을 뺐다(2.3, 2.9).
- [x] 3절 형태: 실제 파일 I/O 경계의 예외 처리는 요청된 가용성·진단 계약을 위한 것이다. 옛 읽기 경로를 제거해 한 경로만 남겼고, 대역도 파일 I/O와 기존 SDK 경계에만 있다. import 우회·대체 구현·시험 전용 export·skip·새 환경 변수 게이트·대기는 없다.
- [x] 새 정보의 역할과 소비자: existence-check 실패 이유는 기존 `settingsNotes`를 통해 `/aaii-router` 보고가 소비한다. 별도 로더·추상화·기록 경로를 만들지 않았다(2.4, 2.5).
- [x] 시험 계약과 mutation: 위 표와 사본 결과 참조. 모델·문구 기대값은 리터럴이며 새 시험에서 제품 상수를 기대값으로 가져오지 않았다.
- [x] 임시 코드와 제거 조건: 남긴 임시 코드 없음.
- [x] 동작 구분: RR-01은 untrusted 경로의 파일 읽기·존재 확인 실패가 라우팅을 막던 회귀를 바로잡는 의미 변경이다. RR-03·04는 동작 보존 정리이며 RR-07은 계약을 보존하는 중복 시험 통합이다(2.8).
- [x] 검토 기록과 남은 경계: 처분 근거는 `_research/standard-disposition-iron-laws.md` 및 `_research/standard-rereview-iron-laws.md`, 구현·수락·mutation 증거는 이 보고서다. 이번 역할은 배정된 구현·시험이며 최종 Iron Laws, 독립 재리뷰, GPT Pro 리뷰와 전체 완료 판정은 코디네이터에게 넘긴다. 로컬 소스 import·오프라인 SDK 대역 통합·실제 임시 파일 I/O 증거를 확보했으나 실제 Pi 호스트에서의 실물 준비 완료는 주장하지 않는다.
