---
applyTo: "packages/server/src/adapters/ws.ts"
---
# ws.ts 파일 내 에러 핸들러 규칙
- `resolveProcedureError` 호출 시, 해당 프로시저의 `declaredErrors` 등록 리스트를 반드시 포함시킬 것.
- `resolveRegisteredDeclaredErrorOrDowngrade` 함수 호출 전, `declaredErrors`가 정의되어 있는지 검증할 것.
- 에러 처리 시, 선언된 에러 목록이 누락되지 않도록 일관된 패턴을 유지할 것.
- 특정 파일(`packages/server/src/adapters/ws.ts`)에 한정된 규칙임을 명확히 할 것.
- 관련 유틸리티 또는 패턴을 참고하여 일관된 에러 처리 구조를 적용할 것.
