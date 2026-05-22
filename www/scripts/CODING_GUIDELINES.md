---
applyTo: "www/scripts/check-twoslash.ts"
---
# 경로별 코딩 가이드라인: non-null assertion 금지
- 인덱스 또는 캡처 접근 시 `!` 연산자를 사용하지 않도록 합니다.
- null 체크 또는 선택적 체이닝(`?.`)으로 명시적 null 처리를 수행하세요.
- 48, 58, 67, 148 라인에서 `!` 사용을 제거하고 적절한 null 체크 또는 선택적 체이닝으로 대체하세요.
- 해당 규칙 위반 시, 잠재적 null 참조 오류 방지 및 코드 안전성 향상을 위해 수정하세요.
- 이 규칙은 `www/scripts/check-twoslash.ts` 파일 내에서만 적용됩니다.
