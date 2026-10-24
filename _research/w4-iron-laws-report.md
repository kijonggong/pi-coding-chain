# W4 N5·N6·IL-09 수정 보고

정본 `docs/engineering-standard.md` 전체, `_research/standard-disposition-iron-laws.md`의 기각 30건 독립 검토 반영 절, `_research/standard-review-iron-laws-rejections.md` 3.6–3.8절을 읽고 W4 담당 항목(N5, N6, IL-09)을 수정했습니다. 소유 파일 외에는 일절 변경하지 않았으며, 커밋·stash·reset·checkout·revert 및 네트워크 접근을 하지 않았습니다.

## 4절 보고 점검표

- [x] **바꾼 책임의 소유 모듈과 바뀐 뒤의 구조**:
  - `N5`: `extensions/aaii-router/settings.ts`의 `parseToggle`이 확장된 불리언 토글 어휘(`on/true/yes/1/enable/enabled`, `off/false/no/0/disable/disabled`)를 직접 파싱하고, `editSetting`은 실패 시 수용 가능한 모든 어휘 목록을 오류 문구에 나열합니다. 두 확장 간 의존성이나 불필요한 공용 모듈 없이 단일 어휘 규격을 독립적으로 유지합니다.
  - `N6`: `extensions/aaii-router/index.ts`에 `commitSettings`를 단일 진입점으로 정의하여, 설정 창(`openSettings`), fallback chain 편집기 저장(`onSave`), 명령행 `set`, 명령행 `reset`의 4가지 경로가 모두 동일한 순서("저장 → `routingChanged` 시 체인 epoch 증가 → `forget` 캐시 무효화 → 상태 줄 갱신 → 환경 변수 우선 키 경고 보고")로 동작합니다.
  - `IL-09`: 순수 선택 규칙인 `chooseTurnCandidate`를 `index.ts`에서 쿨다운 및 후보 선택 규칙을 소유하는 `extensions/aaii-router/cooldown.ts`로 이동했습니다. `cooldown.ts`는 이미 `preferred`, `stepForward`, `available`, `coolingFor`를 소유하고 있으므로 세션 상태(기억된 레이블 및 epoch 유효성)와 쿨다운을 조합하는 선택 규칙의 최적 소유 모듈입니다.
- [x] **더한 것 / 뺀 것**:
  - 더한 것:
    - `settings.ts`: `TOGGLE_ON`, `TOGGLE_OFF`에 `enable/enabled/disable/disabled` 추가, `TOGGLE_WORDS` 상수 정의, 오류 메시지에 수용 어휘 나열.
    - `index.ts`: `commitSettings` 함수, `chooseTurnCandidate`의 `cooldown.ts`로부터의 import.
    - `cooldown.ts`: `TurnState` 인터페이스 및 `chooseTurnCandidate` 함수.
    - 시험: `settings.test.ts`에 확장 어휘 검증 회귀 시험, `cooldown.test.ts`에 `chooseTurnCandidate` 직접 단위 시험(리터럴 기대값), `index.test.ts`에 `set` 및 `reset`의 상태 줄 갱신 및 env override 경고 관측 시험.
    - 문서: `aaii-router/README.md` 및 `openrouter-catalog-filter/README.md`(어휘 문서 한정)에 동일한 토글 수용 어휘 명시.
  - 뺀 것:
    - `index.ts`: 파일 내에 중복되어 있던 설정 창, fallback editor save, `set`, `reset`의 4벌 설정 쓰기/epoch bump/forget/status/env 경고 로직을 제거하고 `commitSettings` 호출로 일원화.
    - `index.ts`: 내부 `chooseTurnCandidate` 함수 정의 제거.
- [x] **3절 형태를 쓴 곳과 그 정당한 이유**:
  - 없음. import 감싸기, silent fallback, 절대 경로, 시험 전용 export나 hook, suppression 주석, skip, 외부 경계 외 대역을 일절 사용하지 않았습니다.
- [x] **새 구조·정보의 실제 역할과 소비자, 기존 기능을 활용하거나 교체한 근거**:
  - `commitSettings`: 설정 변경을 저장하고 런타임 캐시/상태를 갱신하는 imperative shell의 핵심 순서를 단일 출처(Single Source of Truth, 2.4)로 통합. 4개 진입점(창, 편집기, set, reset)이 소비.
  - `chooseTurnCandidate` 이동: 순수 규칙을 imperative shell(`index.ts`)에서 functional core(`cooldown.ts`)로 이동하여(2.6 관심사 분리), TUI/SDK mock 없이 독립적으로 단위 검증 가능.
- [x] **시험마다 지키는 계약 한 줄과 mutation check 결과**:
  - `settings.test.ts: editSetting accepts expanded toggle vocabulary and reports accepted words on failure`: `enable`/`disable` 파싱 성공 및 미인식 단어 입력 시 수용 어휘 리스트 포함 오류 계약 검증. (`TOGGLE_ON`에서 `enable` 제외 시 3개 시험 실패, mutation check 통과)
  - `cooldown.test.ts: chooseTurnCandidate respects valid session epoch, falls back when epoch changed or candidate is cooling`: 세션 상태의 epoch 일치 여부, 레거시 세션(epoch 부재), 쿨다운 상태에 따른 후보 선택 계약을 리터럴 기대값으로 검증. (`epochValid` 조건 변이 시 실패, mutation check 통과)
  - `index.test.ts: set and reset refresh the status line and report environment overrides`: 실제 확장 인스턴스에서 `set`과 `reset` 실행 시 상태 줄이 갱신(clear)되고 활성 환경 변수 override 경고가 발생함을 리터럴 기대값으로 검증. (기존 미갱신/미보고 상태에서 실패, mutation check 통과)
- [x] **남긴 임시 코드와 제거 조건**:
  - 없음.
- [x] **동작 보존 리팩토링인지 의미 변경인지**:
  - 아래 별도 절에 명시.
- [x] **Iron Laws·독립 리뷰·Pro 리뷰의 처분 기록 위치**:
  - 정적 분석 결과: `_research/iron-laws-w4-after.json` (총 32건, W4 소유 10건 처분 완료).
  - 지적별 처분 근거: `_research/standard-disposition-iron-laws.md` 및 본 보고서 하단.

---

## 동작 변경 (Behaviour Changes) 및 의미 변경

1. **N5: aaii-router 토글 어휘 확장 및 오류 문구 변경**:
   - 기존에는 `on`, `true`, `yes`, `1`, `off`, `false`, `no`, `0`만 수용했으나, 이제 openrouter-catalog-filter와 동일하게 `enable`, `enabled`, `disable`, `disabled`도 유효한 토글 값으로 수용합니다.
   - 유효하지 않은 토글 입력 시 오류 문구가 기존 `"expected on or off, got: <value>"`에서 실제 수용 가능한 단어들을 모두 나열하는 `"expected on, true, yes, 1, enable, enabled, off, false, no, 0, disable, disabled, got: <value>"`로 변경되었습니다.
2. **N6: set 및 reset의 상태 줄 갱신과 환경 변수 우선 경고 동작 통일**:
   - 이전에는 `/aaii-router set` 실행 시 상태 줄을 지우지 않았고, `/aaii-router reset` 실행 시 상태 줄을 지우지 않았으며 세션 환경 변수 우선 경고도 누락되었습니다.
   - 이제 설정 창, fallback 편집기 저장, `set`, `reset` 모두 일관되게 `commitSettings`를 통해 상태 줄을 갱신(`publishStatus(ctx, undefined, ..., false)`)하고, 세션에 적용 중인 환경 변수 override 목록을 경고(`warning`)로 보고합니다.

---

## 동작 보존 리팩토링

- **IL-09: chooseTurnCandidate의 cooldown.ts 이동**:
  - 기존 `index.ts`에 있던 순수 규칙 `chooseTurnCandidate`의 알고리즘(epoch 불일치 시 갱신, undefined epoch 호환, 쿨다운 제외 및 preferred 선택)은 완전히 동일하며, 호출 인터페이스 및 런타임 라우팅 동작을 100% 보존합니다.
  - `index.ts`에는 시험 전용 export를 추가하지 않았으며, `index.test.ts`의 기존 행위 관측 시험도 그대로 유지됩니다.

---

## 수락 시험 결과

```powershell
$env:PI_OFFLINE='1'; $env:PI_CODING_FALLBACK_FREE_REFRESH='off'; node --test extensions/aaii-router/*.test.ts extensions/openrouter-catalog-filter/*.test.ts
```

- 결과: **109 pass / 0 fail / 0 skipped** (aaii-router 96 tests, openrouter-catalog-filter 13 tests).

---

## Iron Laws 실행 및 처분 (W4 소유 파일 10건)

`iron-laws audit . --format json -o _research/iron-laws-w4-after.json` 실행 결과 (전체 32건 중 W4 파일 10건):

| ID / 규칙 | 위치 | 처분 | 근거 |
|---|---|---|---|
| IL-08 (ARC-201) | `aaii-router/index.ts:1` (674줄) | 기각 | 정본 2.1: 줄 수를 맞추기 위한 기계적 분할 금지. 책임 분리(TUI 분리 등)는 부채로 기록 |
| IL-09 (ARC-201) | `aaii-router/index.ts:482` | 기각 (수정 완료) | 순수 선택 규칙 `chooseTurnCandidate`는 `cooldown.ts`로 분리 완료. 남은 함수는 조립 루트 및 shell 흐름 조율 |
| IL-10 (ARC-201) | `aaii-router/index.ts:553` | 기각 (수정 완료) | 중복되던 4벌의 설정 저장/상태 갱신 로직을 `commitSettings`로 통합 완료 |
| IL-40, IL-41 (IL-307) | `aaii-router/settings.ts:176, 180` | 의도된 계약으로 기각 | `parseDuration`의 `undefined`는 파서 계약이며, 호출자 `editSetting`이 `not a duration: <raw>`로 변환하여 보고함 |
| IL-14 (ARC-204) | `aaii-router/settings.ts:186` | 기각 (N5 수정 완료) | 무관한 두 확장 간의 의존성이나 불필요한 공용 모듈을 만들지 않음(2.1, 2.2). N5로 어휘 통일 및 README 문서화 완료 |
| IL-42, IL-43 (IL-307) | `aaii-router/settings.ts:188, 189` | 의도된 계약으로 기각 (문구 보완) | `parseToggle`의 `undefined`는 파서 계약이며, 호출자 `editSetting`이 수용 어휘 전체를 나열하여 사용자에게 보고함 |
| IL-48 (PERF-102) | `aaii-router/settings.ts:208` | 기각 | 운영자가 쉼표로 입력하는 소수 origin 목록에 대한 반복으로 크기 증가 경로 없음 |
| IL-24 (IL-301) | `aaii-router/settings.ts:260` | 의도된 계약으로 기각 | 깨진 설정 JSON은 `note`로 보고하고 기본값을 사용하도록 설계된 계약임 |
