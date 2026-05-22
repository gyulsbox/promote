---
applyTo: "packages/openapi/test/scripts/**"
---
# `hasExpectedArtifacts()` 함수 검사 강화 규칙
- 출력 디렉터리(`outputDir`) 내 특정 파일 존재 여부를 추가로 확인한다.
- `expectedFiles` 목록에 명시된 파일들이 모두 존재하는지 검증한다.
- 파일 손상 또는 삭제로 인한 캐시 오류를 방지하기 위해 파일 무결성 검사를 수행한다.
- `fs.existsSync()` 또는 유사한 파일 존재 검사 유틸리티를 활용한다.
- 검증 실패 시 캐시 무효화 또는 재생성 절차를 트리거한다.
