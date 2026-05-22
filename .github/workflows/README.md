---
applyTo: ".github/workflows/**"
---
# GitHub Actions 워크플로우에서 lerna publish 사용 시 권한 및 옵션 일관성 규칙
- `permissions.contents`를 `read`로 명시하였을 경우, `lerna publish` 명령어에 `--no-push` 및 `--no-git-tag-version` 옵션을 반드시 포함하여 git 태깅 및 푸시를 방지한다.
- `lerna publish`가 git 태깅 및 푸시를 수행하는 기본 동작을 고려하여, 워크플로우 내에서 해당 옵션을 일관되게 사용한다.
- 워크플로우 파일 내에서 `permissions.contents` 설정과 `lerna publish` 옵션이 서로 충돌하지 않도록 주의한다.
- 여러 워크플로우 파일에서 반복되는 규칙이므로, 공통 템플릿 또는 액션을 활용하여 일관성을 유지한다.
- `--no-push`, `--no-git-tag-version` 옵션을 명시하지 않으면, 권한 설정이 `read`로 되어 있어 태그 및 푸시가 실패할 수 있음을 문서화한다.
