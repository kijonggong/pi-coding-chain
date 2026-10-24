# W5 보고 (pi)

- 스킬: `engineering-standard` 불러옴 — `C:\Users\airgu\.pi\agent\skills\engineering-standard\SKILL.md`에서 읽음.
- 정본: `docs/engineering-standard.md` 전부 재독함. 처분 기록 `_research/standard-disposition-iron-laws.md`의
  "W1 mutation check (pi) 반영", "W3 결과 확인", "W4 결과 확인" 절을 읽고 그 처분(S1 수정, N7 수정, N8 수정)대로 수행함.

## 범위

이번 변경에서 내가 손대고 남긴 파일은 세 개뿐이다 (`git diff` 기준, 작업 트리에 W1–W4의 미커밋 변경이
앞서부터 섞여 있음은 시작 시 `git status`로 확인):

- `extensions/aaii-router/index.test.ts` — S1 시험 1개 추가
- `extensions/aaii-router/index.ts` — N8: `commitSettings`의 `path` 기본값 제거
- `extensions/quota-providers/catalog.ts` — N7: import 위치 이동 (동작 보존)

## 4절 보고 점검표

- [x] **바꾼 책임의 소유 모듈과 바뀐 뒤의 구조**
  S1: 설정 파일 읽기 오류의 전파 책임은 이미 `settings.ts`의 `readSettingsFile`(ENOENT만 absent, 그 외
  `cannot read settings <path>: <이유>`로 던짐)과 그 호출자 `index.ts`의 `currentSettings`(catch 없이 그대로
  전파)에 있다. 제품 코드는 이미 계약대로라서 바꾸지 않았고, 계약을 확인하는 시험만 호출자 경계에서 추가했다.
  N8: `commitSettings`는 저장→epoch→캐시 무효화→상태 줄→env 경고를 조율하는 함수로, 쓰일 경로는 네 호출자가
  모두 알고 있으므로 인자로 받는다(기본값 경로 삭제).
  N7: `catalog.ts`는 파일 머리 설명 주석이 첫 줄에 오는 저장소 관례를 따른다.
- [x] **더한 것 / 뺀 것**
  더한 것: `index.test.ts`에 시험 1개("routing and the report surface an unreadable settings file instead of
  routing on defaults"), `node:fs/promises`의 `mkdir` import.
  뺀 것: `commitSettings` 시그니처의 `path = globalSettingsPath()` 기본값(호출 지점 네 곳 — `openSettings`,
  fallback editor `onSave`, `set`, `reset` — 은 모두 이미 경로를 넘기므로 함께 고칠 곳은 없었다).
  `catalog.ts`의 import 두 줄은 옮겼을 뿐 더하거나 뺀 것이 없다.
- [x] **3절 형태를 쓴 곳과 그 정당한 이유**: 없음. 시험은 기존 harness(파일 I/O라는 외부 경계의 대역만 있는
  `createModuleHarness`)를 그대로 썼고, try/catch import·시험 전용 export·skip·환경 변수 게이트·setTimeout
  대기·절대 경로를 넣지 않았다. 변이 원복 후 `grep`으로 `currentSettings` 주변에 catch가 남지 않았음을 확인했다.
- [x] **새 구조·정보의 실제 역할과 소비자**: 추가된 시험의 소비자는 다음 담당 리뷰어·변이 검증으로, S2–S5
  기각과 달리 살아남은 변이 S1("호출자가 읽기 오류를 삼켜 기본값으로 라우팅")을 이제 잡는 유일한 시험이다.
  기존 기능 활용 근거: 오류 전파는 이미 `readSettingsFile`→`currentSettings` 경로에 구현돼 있어 제품 변경 불요.
- [x] **시험마다 지키는 계약 한 줄과 mutation check 결과**
  계약: 설정 경로(`PI_AAII_ROUTER_SETTINGS`)가 디렉터리로 읽히지 못하면 라우팅(`route()`)과 보고(`h.command("")`)가
  모두 `cannot read settings …settings.json…EISDIR`로 거부하고, 기본값으로 조용히 라우팅하지 않는다.
  기대값은 리터럴(정규식)이며 제품 상수·함수를 가져오지 않는다. 경로·이유(EISDIR)를 함께 단정한다.
  mutation: `currentSettings`를 `try { … } catch { return DEFAULT_SETTINGS }`로 바꾸니 새 시험만 실패
  (index.test.ts 기준 19 pass / 1 fail) — 살아남았던 변이 S1이 이제 killed. 원복 후 파일을 변이 전 상태로
  정확히 복원했고 전체 수락을 다시 통과했다.
- [x] **남긴 임시 코드와 제거 조건**: 없음.
- [x] **동작 보존 리팩토링인지 의미 변경인지**: 세 항목 모두 동작 보존. S1은 동작 추가가 아니라 기존 동작의
  계약 시험이고, N7은 코드 배치만, N8은 쓰이지 않는 기본값의 제거(2.5)다. 의미 변경 없음.
- [x] **Iron Laws·독립 리뷰·Pro 리뷰의 처분 기록 위치**: `_research/standard-disposition-iron-laws.md`
  (S1·N7·N8 처분은 그 파일의 W3/W4 결과 확인 절에 이미 기록돼 있다). 이번 라운드의 새 지적 없음.

## 수락 결과

```
$env:PI_OFFLINE='1'; $env:PI_CODING_FALLBACK_FREE_REFRESH='off'; node --test extensions/*/*.test.ts
```

- 변경 전 기준: 232 pass / 0 fail / 0 skip
- 변경 후: **233 pass / 0 fail / 0 skip** (S1 시험 1개만큼 증가, 실패·skip 0)
- mutation check 중: 19 pass / 1 fail (새 시험만 실패 — 변이가 잡힘), 원복 후 재실행 233 pass
