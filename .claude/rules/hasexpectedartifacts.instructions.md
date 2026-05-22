---
applyTo: "packages/openapi/test/scripts/**"
---
# 경로 범위 규칙: hasExpectedArtifacts() 함수 검증 강화
- `hasExpectedArtifacts()`는 출력 디렉토리 존재 여부만 확인하므로, 내부 파일의 무결성 검증을 추가하세요.
- 출력 디렉토리 내 파일이 삭제되거나 손상된 경우를 감지할 수 있도록 파일 존재 및 무결성 체크를 구현하세요.
- 구체적인 파일 검증 방법으로는 파일 크기 또는 해시값 비교를 활용하세요.
- 검증 로직을 테스트하여, 손상된 파일이 있을 때 캐시 히트가 방지되도록 하세요.
- 이 규칙은 `packages/openapi/test/scripts/` 경로 내에서만 적용됩니다.
