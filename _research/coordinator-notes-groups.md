# 코디네이터 의심 사항 (리뷰어에게 보내지 않는 메모)

작성: 2026-10-31, 구현 worker(8823dbc4) 실행 중 작성. 처분 단계에서 직접 확인할 목록.
근거: 정본 검증 절차 2단계 — "둘이 도는 동안 코디네이터는 자기 의심 사항을 따로 적어 둔다".

1. **`explain.ts` `consideredList`의 `chosen` 매개변수가 쓰이지 않음** — 표시(`*`)는
   `describeDecision`이 한다. 죽은 매개변수면 지워야 한다(3절).
2. **`strategyName`의 epoch 무시 여부** — `routeFor`가 `request.state?.strategyName`을
   전략 결정에 쓰는데, 연산자가 전략을 바꾸면(`routingChanged` → epoch bump) 저장된
   strategyName이 계속 이긴다. epoch 불일치 시 설정값으로 되돌아와야 일관된다.
3. **rotate의 턴 전진 시점** — `applyStrategy`가 모든 요청(retry·continuation 포함)에서
   `turns`를 전진시킨다. retry/continuation 경로가 `request.state?.strategy`를 보존하는지
   (전진이 폐기되는지) diff로 확인.
4. **`takeHead` 호출부의 slice 우회** — fresh turn에서
   `ordered.slice(findIndex(chosen))`는 chosen을 head로 맞추려는 우회. 단순화 여부(2.2).
5. **settings.ts `parseSettings`의 비문자열 배열 처리** — 숫자 배열이 JSON 문자열로
   들어가 groups에는 유효해도 다른 리스트 키에서는 note로 거부되는지(조용한 기본값 아닌지).
6. **비동기 팩토리에서의 등록 실패 전파** — settings 파일 읽기가 팩토리에서 실패하면
   확장 로드가 깨지는가. ENOENT만 "파일 없음"으로 통과하는지(기존 계약과 동일하게).
7. **`groups` env var와 파일의 우선순위** — env가 이기는 다른 키와 동일한지, env JSON이
   잘못됐을 때 note를 내고 파일값을 유지하는지.
8. **failing 2개 테스트(라이브 설정 드리프트)** — 이번 변경 전부터의 것이 그대로인지,
   이번 변경이 원인이 된 게 아닌지 대조.
