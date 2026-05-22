---
applyTo: "packages/server/src/unstable-core-do-not-import/http/**"
---
# maxBatchSize 제한 관련 경로 내 쉼표 개수 제한 규칙
- `opts.path.split(',')` 호출 전에 경로 내 쉼표 개수를 직접 세어 제한하는 검증 로직을 추가한다.
- 쉼표 개수 제한을 초과하는 경우 요청을 즉시 거부하거나 오류를 반환한다.
- 정적 분석 또는 유틸리티 함수를 활용하여 쉼표 개수 계산을 일관되게 수행한다.
- `maxBatchSize`와 별개로, 쉼표 개수 기반의 DoS 방어 로직을 명확히 문서화한다.
- 해당 규칙은 해당 경로 내에서만 적용하며, 다른 경로나 파일에는 영향을 주지 않는다.
