---
applyTo: ".tool-versions/**"
---
# .tool-versions 파일과 package.json의 pnpm 버전 일치 규칙
- `.tool-versions` 파일 내 pnpm 버전과 루트 `package.json`의 `packageManager` 또는 `engines.pnpm` 버전이 일치하는지 검증한다.
- 버전이 불일치할 경우, `.tool-versions`의 pnpm 버전을 `package.json`에 명시된 버전으로 자동 수정하는 스크립트 또는 규칙을 적용한다.
- 이 규칙은 CI 또는 pre-commit 훅에서 실행되어 도구 체인 불일치를 방지한다.
- `asdf` 또는 `rtx`와 같은 도구들이 일관된 버전으로 동작하도록 보장한다.
- 버전 일치 규칙을 문서화하여 팀 내에서 공유하고, PR 검토 시 반드시 체크하도록 한다.
