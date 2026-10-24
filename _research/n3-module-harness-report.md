# N3 공통 모듈 시험 하네스 처분 보고

기준: `docs/engineering-standard.md` 2.1–2.11, 3절, 4절 및 `_research/standard-disposition-iron-laws.md`의 N3.

## 결과와 책임

동작 보존 리팩토링이다. 루트 `test-support/module-harness.ts`가 임시 디렉터리 생성, 실제 모듈 복사, 제공된 패키지 파일 작성, 동적 import, 정리를 단독 소유한다. 소비 테스트는 복사할 모듈 목록과 대역 패키지의 파일 내용을 제공하고 테스트 수명에 맞춰 cleanup을 호출한다.

`package.json`의 `pi.extensions`는 `extensions/openrouter-catalog-filter`, `extensions/coding-fallback`, `extensions/aaii-router`만 나열한다. 새 루트 디렉터리 `test-support/`는 목록 밖에 있어 확장으로 로드되지 않는다.

더한 것: 공통 하네스 한 파일과 네 테스트의 연결. 뺀 것: picker·router·filter의 복사/패키지 작성/import/정리 중복 구현과 `writeSdkStubs` 파일 작성 함수. aaii-router의 기존 `test-support.ts`는 두 테스트가 실제 공유하는 SDK 문자열과 패키지 내용 생성만 맡는 `sdkStubPackages`로 바꾸었다. 각 대역의 리터럴 키 시퀀스, 반환값, 동작 및 패키지 manifest 내용은 보존했다. 기존 단정과 테스트 본문은 보존했고 picker 본문의 추가 import만 공통 loader를 이용하도록 연결했다.

## 검증

네트워크를 사용하지 않았다. 다음 환경과 명령으로 변경 전후 전체 검사를 실행했다.

```powershell
$env:PI_OFFLINE='1'
$env:PI_CODING_FALLBACK_FREE_REFRESH='off'
node --test extensions/*/*.test.ts
```

| 검사 | tests | pass | fail | skip |
|---|---:|---:|---:|---:|
| 변경 전 | 225 | 225 | 0 | 0 |
| 최종 변경 후 | 225 | 225 | 0 | 0 |

공통 하네스의 import 경로에 존재하지 않는 `missing-entry` 디렉터리를 삽입하는 고장을 한 번 주입했다. 각 소비 파일을 개별 실행해 아래 결과를 확인하고 `finally`에서 정확한 원본으로 복원했다. 복원 뒤 위 전체 명령이 통과했다.

| 소비 파일 | 지키는 계약 | 변이 결과 |
|---|---|---|
| coding-fallback/picker.test.ts | 실제 picker의 표시·필터·선택·취소 및 add의 점수 오류 전파/모듈 상대 기본 경로 | 9 fail, 0 pass, 0 skip, 종료 1 |
| aaii-router/fallback-tui.test.ts | 실제 fallback editor의 키 입력·초안·저장·실패 동작 | 18 fail, 0 pass, 0 skip, 종료 1 |
| aaii-router/index.test.ts | 실제 router 등록·라우팅·명령·편집 저장 및 점수 파일 오류/기본 경로 | 18 fail, 0 pass, 0 skip, 종료 1 |
| openrouter-catalog-filter/index.test.ts | 실제 확장의 remote→store→builtin 대체, 건너뛴 이유 표시 및 list 모델 ID 출력 | 5 fail, 0 pass, 0 skip, 종료 1 |

이 검사는 세 구현 계열 모두 공통 하네스를 실제로 거친다는 것을 확인한다. SDK 자체나 실제 네트워크 서비스의 정확성은 검증 범위가 아니다. 추가·삭제·skip·약화한 테스트 또는 단정은 없다.

## 정적 분석과 리뷰 처분

`iron-laws audit . --format json -o <임시 디렉터리>/n3-iron-laws.json`을 한 번 실행했다. 74개 파일, complete, 34건(CRITICAL 0/HIGH 5/MEDIUM 21/LOW 8), 억제 0, 등급 D, 도구 종료 1이다. JSON `violations`를 N3 소유 파일과 새 공통 모듈 경로로 대조했으며 해당 지적은 0건이다. 저장소 전체 34건은 기존 처분 및 총괄의 종합 검토 대상이며 이번 작업이 전체 감사를 통과했다고 주장하지 않는다.

독립 코드 리뷰와 기존 GPT Pro 대화 리뷰는 수행하지 않았다. 정본 2.10의 총괄 직접 배정 원칙과 이번 작업의 네트워크 금지에 따라 총괄에게 후속 리뷰를 인계한다. N3 구현·검증 외 제품 코드와 기존 작업 트리는 건드리지 않았으며 커밋·stash·reset·checkout·revert를 실행하지 않았다.

## 4절 보고 점검표

- [x] 책임 소유 모듈과 구조: 루트 module-harness가 파일 시스템 경계와 import/정리를 소유하며 네 테스트가 실제 모듈 목록과 대역 내용을 전달한다.
- [x] 더한 것/뺀 것: 공통 하네스 하나를 더하고 세 계열의 중복 구현을 제거했으며 네 호출 지점을 전환했다.
- [x] 3절 형태와 정당한 이유: 공통 helper는 실제 시험 환경 경계를 소유한다; 기존 구현을 제거해 실행 경로가 하나이며 SDK 대역 정의를 가져가지 않는다.
- [x] 실제 역할과 소비자/교체 근거: 네 소비 테스트에 필요한 복사·패키지 작성·import·cleanup만 제공하며 기존 중복을 교체했다; 추가 옵션이나 사용하지 않는 기능은 없다.
- [x] 계약과 mutation check: 위 네 소비 파일별 계약과 9/18/18/5건 실패, 원복 뒤 전체 225건 통과를 기록했다.
- [x] 임시 코드와 제거 조건: 남긴 임시 코드는 없음; 고의 결함은 원복했다.
- [x] 의미 구분: 동작 보존 리팩토링이며 제품 의미 변경 없음.
- [x] 리뷰 처분 위치: 이 보고서의 정적 분석과 리뷰 처분 절; N3 정적 지적 0건, 독립·Pro 리뷰는 총괄 인계.
