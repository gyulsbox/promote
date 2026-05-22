---
applyTo: "packages/server/src/unstable-core-do-not-import/http/**"
---
# maxBatchSize 제한 관련 경로 내 쉼표 개수 제한 규칙
- `opts.path.split(',')` 호출 전에 쉼표 개수를 직접 세어 제한하는 로직을 구현한다.
- 쉼표 개수 제한을 통해 배열 할당 크기를 제어하여 DoS 공격 가능성을 방지한다.
- 경로 내 쉼표 개수 초과 시 요청을 즉시 거부하는 검증 로직을 추가한다.
- `maxBatchSize`와 별개로 쉼표 개수 제한 규칙을 적용하여 보안을 강화한다.
- 관련 유틸리티 또는 정규식을 활용하여 쉼표 개수 검증을 일관되게 수행한다.


---
applyTo: "packages/server/src/unstable-core-do-not-import/http/**"
---
# maxBatchSize 제한 관련 경로 내 쉼표 개수 제한 규칙
- `opts.path.split(',')` 호출 전에 쉼표 개수를 직접 세어 제한하는 검증 로직을 추가하세요.
- 쉼표 개수 제한을 초과하는 경우 요청을 즉시 거부하거나 오류를 반환하세요.
- `maxBatchSize`와 별개로, 경로 내 쉼표 개수에 따른 DoS 공격 방어를 우선시하여 구현하세요.
- 정적 분석 또는 유닛 테스트를 통해 쉼표 개수 제한 로직이 항상 수행되는지 검증하세요.
- 해당 규칙은 이 경로 내에서만 적용하며, 다른 경로에는 영향을 미치지 않도록 하세요.


---
applyTo: "packages/server/src/unstable-core-do-not-import/http/**"
---
# 경로 크기 제한 및 DoS 방어 가이드
- `opts.path.split(',')` 호출 전에 `opts.path`의 길이 또는 콤마 개수를 검사하여, 배열 할당 크기를 제한한다.
- 정규 표현식 또는 문자열 길이 검사를 통해 허용된 경로 길이 또는 콤마 개수 범위 내인지 검증한다.
- `maxBatchSize`와 별개로, 경로 내 콤마 개수에 따른 배열 크기 증가를 방지하는 로직을 추가한다.
- 경로 검증 후, 안전한 크기 범위 내에서만 `split(',')`을 수행하도록 한다.
- `path.split(',')` 호출 전에 `String.prototype.match()` 또는 `String.prototype.length`를 활용하여 크기 제한을 적용한다.
