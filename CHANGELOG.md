# Changelog

## [0.5.1](https://github.com/gyulsbox/promote/compare/v0.5.0...v0.5.1) (2026-05-22)


### Bug Fixes

* **build:** run pnpm build before npm publish via prepublishOnly ([0a57b8e](https://github.com/gyulsbox/promote/commit/0a57b8ea1a09b9ad1d52310884e7acce0b3ecdd0))

## [0.5.0](https://github.com/gyulsbox/promote/compare/v0.4.0...v0.5.0) (2026-05-22)


### Features

* add A+B hybrid clustering ([e02af7a](https://github.com/gyulsbox/promote/commit/e02af7a0467f728e55a4121616a2c6de284130e3))
* add AI reviewer filter and noise filter ([a3df131](https://github.com/gyulsbox/promote/commit/a3df13125170735023080d6285c0191525c54b51))
* add classification, drafting, and digest generation (Phase 3) ([b94a22b](https://github.com/gyulsbox/promote/commit/b94a22ba9754cbfadb5983b1c8326e3b583ae4f5))
* add CLI with interactive init, scan, and UX polish ([104beaf](https://github.com/gyulsbox/promote/commit/104beaf63ef7e41802dc5aeba934f09d1441fa7a))
* add comment normalization pipeline ([fff755b](https://github.com/gyulsbox/promote/commit/fff755bfc6f9a77c5cec719adf96e0296ca7905d))
* add completion summary with file preview and i18n closing quote ([bb4341d](https://github.com/gyulsbox/promote/commit/bb4341d3788920f66b4d03b705370646c38c777c))
* add core types and config loader ([b21f67a](https://github.com/gyulsbox/promote/commit/b21f67a59e1ff2fb9f797eb7f4a659204812b01c))
* add GitHub review comment ingestion ([7228edc](https://github.com/gyulsbox/promote/commit/7228edcb1bf04c5ae5d391a742b86c589a2a483d))
* add interactive review and promote command ([610de33](https://github.com/gyulsbox/promote/commit/610de33cbefd62a81b3a56dfc75acacef7199ba4))
* add LLM provider abstraction and cost tracker ([1d227de](https://github.com/gyulsbox/promote/commit/1d227def71e28c0fee8d0363a5c3a15da558ede4))
* add multi-tool support for init (Claude/Codex/Copilot/Cursor/Windsurf/Gemini) ([8b9d7cf](https://github.com/gyulsbox/promote/commit/8b9d7cf34c843caff02a5823aadee0d68327ebe6))
* add promote/ignore/snooze commands and graceful Ctrl+C ([534dadf](https://github.com/gyulsbox/promote/commit/534dadf55950523abf9dc5f9f3718f45bf212e61))
* add SQLite storage layer ([a3d3289](https://github.com/gyulsbox/promote/commit/a3d3289d241ada529ba843649befd22cee601a5c))
* **cluster+cli:** clusteringModel + scan --mode flag + Gemini + npm/migration ([acbb6f3](https://github.com/gyulsbox/promote/commit/acbb6f3d54f89713c922d9d315bd7f39a8a4059a))
* enhance init with memory target setup and knowledge reference instructions ([a8d2672](https://github.com/gyulsbox/promote/commit/a8d2672a779903c3e2550d2e7988b158efbd2ca3))
* enhance scan with parallel classification, auto-repo detection, and remote repo guard ([05a73df](https://github.com/gyulsbox/promote/commit/05a73df95731aa6ea7d1c1f271ab264b06e75ff3))
* **human-signal:** general PR conversation fetch + LLM matching pipeline ([dbdab18](https://github.com/gyulsbox/promote/commit/dbdab187450d6e86b2cd76230dae9b5f3f92222f))
* **scan:** provider/models display, Ctrl+C, clack cancel, threshold tuning, digest config ([d135ce9](https://github.com/gyulsbox/promote/commit/d135ce91983aa9c9571bc8477de8f34d407c69bc))
* **v0.2:** clustering overhaul + core bug fixes ([c62845a](https://github.com/gyulsbox/promote/commit/c62845a1a0688cefce09b36e45152d004fdd2289))
* **v0.3:** normalizer hardening for 2025-2026 bot formats ([6b3608e](https://github.com/gyulsbox/promote/commit/6b3608e918ee1e40dd3886739e59d98c2fdf1c12))
* **v0.4:** human reply/reaction signal + UX polish + sendDiffHunksToLLM ([c33aea6](https://github.com/gyulsbox/promote/commit/c33aea6e1170a2754aadabd7c29058cc473a3ea0))


### Bug Fixes

* add promote-cli bin alias for npx compatibility ([e9a24e8](https://github.com/gyulsbox/promote/commit/e9a24e826d95f01be59b34f1b754238646bca35a))
* **cluster+llm:** reasoning-model handling + recursive reduce + parallel + termination guards ([73b3da0](https://github.com/gyulsbox/promote/commit/73b3da0c2db519aaa5ee85f3510c848a10bbe0a9))
* correct bin path for npm, bump to 0.1.1 ([0417b84](https://github.com/gyulsbox/promote/commit/0417b84c3c77dcf914af48d3f11348c7432c1a01))
* improve review UX — remove ignore option, add show full patch, cleaner layout ([94b7c35](https://github.com/gyulsbox/promote/commit/94b7c351bcacd13d710566ea7ccdc15050cada0f))
* ordered parallel output with terminal-width truncation ([91dccbb](https://github.com/gyulsbox/promote/commit/91dccbb06dcde7627d80624f1fc1ecd26bab1299))
* set temperature 0 for clustering and classification determinism ([ee1824e](https://github.com/gyulsbox/promote/commit/ee1824ef5ab670232f53c0e29185589b47176fb8))
* validate file paths before writing to prevent junk files ([05b25fd](https://github.com/gyulsbox/promote/commit/05b25fd5f0346ea767195cb68df62e58d1c24b47))


### Tuning

* **defaults+cluster:** non-reasoning model lines + Anthropic concurrency=1 + prompt tighten ([aea5a0b](https://github.com/gyulsbox/promote/commit/aea5a0bca5712c90f73c9d7fd8ab395eb3188b60))


### Refactors

* review-driven cleanup — wire llmRefine, scan resilience, type renames ([331e420](https://github.com/gyulsbox/promote/commit/331e4201dad62d7ae39a42c23c46d0cbdeeef757))


### Docs

* add init demo GIF, remove article links from README ([676bb4e](https://github.com/gyulsbox/promote/commit/676bb4e7019827041a51d2270932616d1d4195d7))
* add README with quick start, routing taxonomy, and multi-tool reference ([a1f2476](https://github.com/gyulsbox/promote/commit/a1f24764d743d02915633c8047f0fc5479f3c9a3))
* add roadmap to nav, remove style reference from roadmap ([e1b5e23](https://github.com/gyulsbox/promote/commit/e1b5e2374ddd1dd3fcbb93b8e4ee83948aaac638))
* add scan demo GIF to README ([ec1d131](https://github.com/gyulsbox/promote/commit/ec1d131bed45694c29ba519b8378e072a9ffc71e))
* README clustering modes + comparison + PRD move + audit cleanup ([3b1049b](https://github.com/gyulsbox/promote/commit/3b1049bd9aa36ff286c64e94cfd61e7a404af7fb))
* revamp README with thesis-first layout, roadmap, and realistic scan demo GIF ([e016e1b](https://github.com/gyulsbox/promote/commit/e016e1bf97162ccf0f1a282005ead2aac9bf98c8))
* sync PRD with implementation decisions and landing page plan ([3acfd3c](https://github.com/gyulsbox/promote/commit/3acfd3c26fa24ce0f50db3574bc5dc660224b144))
* trim scan GIF, reorder demo (init first) ([3826b95](https://github.com/gyulsbox/promote/commit/3826b95f9bfba9e83e551e62947c6d3e932c8001))
* update PRD with competitive analysis, token efficiency, and clustering approach ([b64e87e](https://github.com/gyulsbox/promote/commit/b64e87ecc05bde0abc2cccca73f92d1699a933bc))
