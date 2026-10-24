# W3 IL-29·IL-31·N4 수정 보고

정본 `docs/engineering-standard.md` 전체, `standard-disposition-iron-laws.md`의 기각 30건 독립 검토 반영 절, `standard-review-iron-laws-rejections.md` 3.2–3.5절을 읽고 담당 항목만 수정했다. 기존 작업 트리 변경을 보존했으며 커밋·stash·reset·checkout·revert 및 네트워크 접근을 하지 않았다.

## 4절 보고 점검표

- [x] 책임 소유와 구조: `free-models.ts`의 기존 `loadFreeSnapshot`이 파일 읽기·ENOENT 구별·파서 결과 판정을 소유한다. `config.ts`는 실패 이유를 notice로 전달하며 모델 목록을 보존하고, `free-fetch.ts`는 같은 로더를 사용해 실패 이유를 refresh 결과에 붙인다.
- [x] 더한 것 / 뺀 것: 경로·이유를 담은 로더 오류, config notice 전달 필드, refresh 진단, 회귀 시험과 README 설명을 더했다. `free-fetch.ts`의 중복 `readExisting`과 읽기 실패를 조용히 접던 경로, catalog의 중복 host 리터럴을 지웠으며 실제 호출자인 config와 refresh를 함께 수정했다.
- [x] 3절 형태와 정당성: 새 wrapper·common/util·시험용 export·hook·skip·억제 주석은 없다. config의 catch는 요구된 보수적 model_list 보존과 notice 보고를 담당하고 refresh의 catch는 기존 조회·쓰기 흐름을 지속하면서 읽기 실패를 사용자에게 전달한다. 대역은 OS 파일 읽기 권한 오류와 HTTP fetch 경계에만 사용했다.
- [x] 실제 역할·소비자와 재사용: `freeReadError`는 check/sync/add가 공유하는 notice 생성 경로에서 소비한다. 반복될 ENOENT 구별을 새 공용 모듈 대신 기존 로더에 모았고 `loadScores`의 읽기·파싱 오류 순서와 메시지 형태를 따랐다. catalog는 기존 `parseProviderUrl`과 N1의 파싱 후 실패 방식으로 `DASHSCOPE.baseUrl`에서 hostname을 계산한다.
- [x] 시험 계약과 mutation: 아래 표 및 `w3-mutation-results.json`에 기록했다. 수정 전 새 시험 5건 모두 실패했고 수정 후 33개 집중 시험과 123개 전체 수락 시험이 통과했으며 변이 5개 모두 검출했다.
- [x] 임시 코드와 제거 조건: 없음. 변이 적용은 메모리에 보관한 해당 파일 원본을 finally에서 복구했으며 원복 후 전체 시험이 통과했다.
- [x] 동작 보존 / 의미 변경: 아래에 별도로 구분했다.
- [x] 리뷰 처분 위치: 정적 분석 원본은 `iron-laws-w3-after.json`, 담당 지적 처분은 아래에 있다. 독립 코드 리뷰와 기존 대화의 GPT Pro 리뷰는 코디네이터 후속 단계이며 아직 수행하지 않았다.

## 의미 변경

- IL-31: 파일이 없을 때만 undefined를 반환한다. 권한·디렉터리 읽기 오류는 `cannot read free snapshot <path>: <reason>`, 깨진 JSON이나 파서가 거부한 텍스트는 `invalid free snapshot <path>: malformed JSON or unusable snapshot` 오류가 된다.
- IL-31 호출자: config는 위 오류를 notice에 포함하고 snapshot 부재와 같은 보수적 모델 목록 보존을 유지한다. 공통 readInputs→composeText→noticesFor 경로를 통해 check/sync/add에 전달한다.
- IL-29: refresh는 이전 파일의 읽기·파싱 실패를 `could not read previous snapshot <path>: <reason>`으로 보고한다. 조회가 모두 실패한 결과, dry run, 쓰기 성공 및 쓰기 실패 결과에 원인이 남는다.

## 동작 보존 리팩토링

- N4: 현재 DashScope host 값은 동일하며 주소 변경 시 제외 보고의 host도 같은 주소를 따른다.
- refresh의 기존 mkdir→임시 파일 write→rename 절차, probe 실패 시 덮어쓰기 거부, freshness 규칙은 유지했다.
- 경로 없는 `parseFreeSnapshot`의 undefined 계약(IL-30)은 유지하고 파일 경로를 아는 로더에서 오류로 변환한다.

## 시험 계약과 증거

| 시험 | 보호 계약·실제 경계 | 독립 기대값 및 변이 검출 |
|---|---|---|
| free-models: snapshot loading distinguishes… | 실제 임시 파일의 ENOENT·깨진 JSON·디렉터리와 fs 읽기 경계의 EACCES를 구별 | undefined, 오류 메시지, EISDIR, permission denied 리터럴; IL31-read 및 IL31-parse 변이 실패 |
| free-models: config reports a corrupt… | 실제 로더→check/sync→파일 보존·notice | 오류 문구와 managed group 이름 리터럴, 입력 model_list 보존; IL31-notice 변이 실패 |
| free-fetch: refresh reports corrupt and directory… | 실제 깨진 파일/디렉터리 읽기 실패와 probe 대상 없음 결과 | 진단 문구, EISDIR, ENOENT의 기존 결과 메시지 리터럴; IL29-result 변이 실패 |
| free-fetch: refresh retains a permission… | fs EACCES와 HTTP 응답 경계; 실제 dry run/쓰기/rename 실패 결과 | written/error, 진단 문구, listed=0, free=[] 리터럴; IL29-result 변이 실패 |
| quota catalog: exclusion reporting follows… | 실제 catalog와 모든 의존 모듈을 기존 module-harness로 복사해 endpoint 정의만 변경 | baseUrl과 host를 example.invalid 리터럴로 확인; N4-host 변이 실패 |

catalog 시험은 내부 함수를 stub하지 않으며 기본 주소 변경이라는 구성 변이를 넣어 실제 catalog 초기화를 실행한다. 모든 복사·격리에는 기존 `test-support/module-harness.ts`를 사용한다. 제품의 상수를 기대값으로 가져오지 않았다.

변이별 결과: IL31-read 3 fail, IL31-parse 3 fail, IL31-notice 1 fail, IL29-result 2 fail, N4-host 1 fail이며 각 실행 종료코드는 1이다. 전체 원복 후 다음 수락 명령은 **123 pass / 0 fail / 0 skipped**였다.

```powershell
$env:PI_OFFLINE='1'
$env:PI_CODING_FALLBACK_FREE_REFRESH='off'
node --test extensions/coding-fallback/*.test.ts extensions/quota-providers/*.test.ts
```

## Iron Laws 1회 실행과 처분

`iron-laws audit . --format json --output _research/iron-laws-w3-after.json`을 네트워크 없이 한 번 실행했다. 저장소 전체 지적 32건으로 종료코드 1이며 자동 등급을 통과로 주장하지 않는다. W3 소유 파일의 지적 4건은 다음과 같이 처분하며 다른 작업자 범위는 기존 총괄 처분과 후속 리뷰 대상으로 남긴다.

| 위치·규칙 | 처분 | 근거 |
|---|---|---|
| free-fetch refreshFreeSnapshot ARC-201 | 근거 있는 기각 | 조회·신선도·쓰기·결과를 순서대로 조율하는 기존 shell 책임이다; 이번에 중복 읽기를 제거했으며 줄 수만 맞추는 전달 함수 분리는 2.1·2.2에 맞지 않는다 |
| free-models EXPLABS_BASE_URL AI-101 | 근거 있는 기각 | 이미 처분된 고정 공개 upstream 주소이며 단일 출처이고 환경별 개발 경로가 아니다 |
| free-models parseFreeSnapshot IL-301 | 의도된 계약으로 기각 | IL-30 처분대로 경로 없는 파서는 undefined로 거부를 표현한다; 실제 파일 호출자는 이번 IL-29·IL-31에서 경로·이유로 보고한다 |
| quota catalog DASHSCOPE.baseUrl AI-101 | 근거 있는 기각 | IL-06의 공개 endpoint 리터럴 기각을 유지하며 파생 host 중복 N4는 수정했다 |

## 검증 범위와 남은 작업

소스 실행·파일 시스템 통합 및 fs/fetch 외부 경계 대역 통합을 확인했다. 실제 원격 provider 호출은 금지 조건에 따라 수행하지 않았고 실제 운영 설정도 변경하지 않았다. MATLAB·실물 관련 완료 단계는 이 작업에 해당하지 않으며, 독립·Pro 리뷰의 최종 처분은 총괄이 진행해야 한다.
