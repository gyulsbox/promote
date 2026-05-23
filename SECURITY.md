# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.7.x   | ✅        |
| < 0.7   | ❌        |

## Reporting a vulnerability

Please report security issues privately through GitHub Security Advisories
rather than a public issue:

<https://github.com/gyulsbox/promote/security/advisories/new>

We aim to acknowledge reports within 7 days.

## Scope

promote-cli is a local CLI that calls third-party LLM providers with your own
API key. Reports that affect installed users or CI consumers are in scope:

- Issues that could exfiltrate API keys, repository tokens, or PR content
- Bypasses of secret redaction (`privacy.redactSecrets`)
- Issues that cause unintended writes to your repository
- Supply-chain issues in the published npm package

Issues in the third-party services we call (OpenAI, Anthropic, Google,
GitHub) should be reported to those providers directly.
