---
applyTo: "packages/server/src/adapters/ws.ts"
---
# ws.ts 파일 내 에러 핸들러 규칙
- `resolveProcedureError` 호출 시, 반드시 해당 프로시저의 `declaredErrors` 등록 리스트를 함께 전달할 것.
- `resolveRegisteredDeclaredErrorOrDowngrade` 함수가 `declaredErrors` 누락 시 올바른 처리로 이어지도록 검증할 것.
- 에러 처리 로직에서 `declaredErrors` 등록 리스트의 존재 여부를 체크하는 조건문을 추가할 것.
- 관련 유틸리티 또는 패턴을 활용하여 일관된 에러 핸들링 구조를 유지할 것.
- 특정 파일(`packages/server/src/adapters/ws.ts`)에 한정된 규칙으로, 다른 모듈에는 적용하지 않을 것.


---
applyTo: "packages/server/src/adapters/ws.ts"
---
# ws.ts 파일 내 에러 핸들러 규칙
- `resolveProcedureError` 호출 시, 해당 프로시저의 `declaredErrors` 등록 리스트를 반드시 포함시킬 것.
- `resolveRegisteredDeclaredErrorOrDowngrade` 함수 호출 전, 프로시저의 `declaredErrors`가 정의되어 있는지 검증할 것.
- 에러 처리 로직에서 `declaredErrors` 누락 시, 명확한 경고 또는 예외를 발생시켜 누락 방지.
- 반복적으로 발생하는 문제이므로, 관련 유틸리티 또는 미들웨어에서 일관된 에러 등록 패턴을 적용할 것.
- 코드 리뷰 시, `resolveProcedureError` 호출 부분에 `declaredErrors` 전달 여부를 반드시 확인할 것.
