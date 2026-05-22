---
applyTo: "packages/openapi/test/routers/**/core/serverSentEvents.gen.ts"
---
# serverSentEvents.gen.ts에서의 onSseEvent 호출 규칙
- 메타데이터 전용 프레임에 대해서는 `onSseEvent` 호출을 건너뛰도록 합니다.
- `retry:`-전용 청크의 경우 `data: undefined`로 호출되는 것을 방지합니다.
- Heartbeat 또는 `retry:`-전용 청크에서도 `data`가 `undefined`인 `onSseEvent` 호출을 피합니다.
- 이 규칙은 해당 파일들 내에서만 적용하며, 다른 경로나 파일에는 영향을 주지 않습니다.
- 관련 유틸리티 또는 패턴을 참고하여 조건문을 추가하거나 수정하세요.
