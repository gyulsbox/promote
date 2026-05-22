---
applyTo: "packages/openapi/test/routers/**/core/serverSentEvents.gen.ts"
---
# 서버 Sent 이벤트 처리 규칙
- 메타데이터 전용 프레임에 대해 `onSseEvent` 호출을 건너뜁니다.
- `retry:` 전용 청크는 `data: undefined`로 호출되지 않도록 합니다.
- `StreamEvent.data`가 필수임을 고려하여 `data: undefined` 호출을 방지합니다.
- 이 규칙은 해당 파일 내 특정 경로에 한정된 구현 세부사항임을 유념합니다.
- 반복적으로 발생하는 문제를 방지하기 위해 관련 호출 조건을 명확히 합니다.
