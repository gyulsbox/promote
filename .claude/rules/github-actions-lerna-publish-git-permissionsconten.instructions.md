---
applyTo: ".github/workflows/**"
---
# GitHub Actions 워크플로우에서 lerna publish 사용 시 권한 및 옵션 규칙
- `permissions.contents`를 `read`로 명시하여 태그 및 푸시 권한을 제한한다.
- `lerna publish` 명령어에 `--no-push`와 `--no-git-tag-version` 옵션을 반드시 포함시켜 git 태깅 및 푸시를 방지한다.
- 워크플로우 내에서 `lerna publish` 호출 시 옵션이 누락되지 않도록 검증한다.
- 태그 및 푸시 작업이 필요 없는 경우에만 `lerna publish`를 실행하도록 조건을 설정한다.
- 관련 유틸리티 또는 스크립트에서 옵션 검증 및 권한 설정을 자동화한다.
