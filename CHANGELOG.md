# Changelog

## [1.0.0](https://github.com/Paubox/paubox-cli/compare/paubox-cli-v0.4.0...paubox-cli-v1.0.0) (2026-08-19)

First stable release. `paubox-cli` now has a declared public API and follows [Semantic Versioning](https://semver.org) against it — see [Versioning and stability](https://github.com/Paubox/paubox-cli#versioning-and-stability) for what the version number does and does not cover. Versions 0.1.0 through 0.4.0 were initial development releases and carried no stability guarantee.


### ⚠ BREAKING CHANGES

The authentication changes below landed in [#38](https://github.com/Paubox/paubox-cli/issues/38) but were never released, so they take effect for anyone upgrading from 0.4.0 or earlier.

* **auth:** API authentication no longer uses a username. `paubox auth login` prompts for an API key only — scripts that drive it with piped stdin need their input updated.
* **auth:** The Email API base URL moved from `https://api.paubox.net/v1/{username}` to `https://api.paubox.com/v1`.
* `apiUsername` was removed from the `PauboxCredentials` type, and the `saveCredentials(username, key)` overload was removed. Both are internal as of this release; they are noted here for anyone who had been importing them.

Existing stored credentials keep working without re-authenticating: the API key itself is unchanged, and the now-unused `apiUsername` field is ignored and dropped the next time credentials are written. Run `paubox auth status` to confirm.

Because this is a major release, `^0.4.0` ranges will not resolve to 1.0.0. Upgrade explicitly:

```bash
npm install -g paubox-cli@latest
```

### Features

* declare stable public API and drop username from authentication ([#40](https://github.com/Paubox/paubox-cli/issues/40)) ([3b281c8](https://github.com/Paubox/paubox-cli/commit/3b281c8ec2d3ca3290e639566cbc5a43e3a27916))

## [0.4.0](https://github.com/Paubox/paubox-cli/compare/paubox-cli-v0.3.0...paubox-cli-v0.4.0) (2026-08-13)


### Features

* add authenticated Forms API commands via scoped API keys ([#33](https://github.com/Paubox/paubox-cli/issues/33)) ([e7ecbe8](https://github.com/Paubox/paubox-cli/commit/e7ecbe8f34f4d12d0e5ad697aeda2b382eff09b0))

## [0.3.0](https://github.com/Paubox/paubox-cli/compare/paubox-cli-v0.2.0...paubox-cli-v0.3.0) (2026-05-21)


### Features

* add paubox forms command group ([#15](https://github.com/Paubox/paubox-cli/issues/15)) ([4568eeb](https://github.com/Paubox/paubox-cli/commit/4568eeb0f5022ea9531f14c86ed0e9f95ad6d6eb))
* Windows support and paubox forms command group ([#17](https://github.com/Paubox/paubox-cli/issues/17)) ([39b24f9](https://github.com/Paubox/paubox-cli/commit/39b24f9778a5e4b59a6a9c551d751f47fd817724))


### Bug Fixes

* point forms API at apx.paubox.com gateway ([#18](https://github.com/Paubox/paubox-cli/issues/18)) ([7a25a98](https://github.com/Paubox/paubox-cli/commit/7a25a98245d625c8204bcbf14bbe0c2952a6975b))

## [0.2.0](https://github.com/Paubox/paubox-cli/compare/paubox-cli-v0.1.3...paubox-cli-v0.2.0) (2026-05-21)


### Features

* add Windows support ([3d647db](https://github.com/Paubox/paubox-cli/commit/3d647db2f8e542f166a7e4a10e84e818c0f143d2))
* add Windows support ([40efc48](https://github.com/Paubox/paubox-cli/commit/40efc487fdc42949e6fc316d3c4cdabcf8a11788))

## [0.1.3](https://github.com/Paubox/paubox-cli/compare/paubox-cli-v0.1.2...paubox-cli-v0.1.3) (2026-05-20)


### Bug Fixes

* chain publish job after release-please in the same workflow ([16943c2](https://github.com/Paubox/paubox-cli/commit/16943c2f59f10b32663c345a726b4f9e85a7bc95))
* chain publish job after release-please in the same workflow ([dd0293e](https://github.com/Paubox/paubox-cli/commit/dd0293e82dc51e0a4ad493081033e6712e93f76f))
* read CLI version from package.json instead of hardcoding it ([eac4434](https://github.com/Paubox/paubox-cli/commit/eac4434a4aa1a0d89747ccec63d053f97aac61a7))
* read CLI version from package.json instead of hardcoding it ([ee945b0](https://github.com/Paubox/paubox-cli/commit/ee945b0243e5e05b28348c12f23d9f0118281a9b))

## [0.1.2](https://github.com/Paubox/paubox-cli/compare/paubox-cli-v0.1.1...paubox-cli-v0.1.2) (2026-05-20)


### Bug Fixes

* capitalize Paubox in repo URLs to match OIDC claim casing ([61a821b](https://github.com/Paubox/paubox-cli/commit/61a821b5f8f49e0f153660f3deffde4f09c4ace3))
* capitalize Paubox in repo URLs to match OIDC claim casing ([bb91834](https://github.com/Paubox/paubox-cli/commit/bb9183461ed632f1c9799e82d8aa91d477478819))
* match release-please tag pattern in publish workflow ([22a14d8](https://github.com/Paubox/paubox-cli/commit/22a14d84334dc424a14d6536e43990a816304f3f))
* match release-please tag pattern in publish workflow ([515a3a9](https://github.com/Paubox/paubox-cli/commit/515a3a9fbf6bc7be670206d687eb568351587a85))
* upgrade npm before publishing for Trusted Publishing OIDC support ([3bc7b0b](https://github.com/Paubox/paubox-cli/commit/3bc7b0bc9ee424024edf72136fe6ce56fc97aa52))
* upgrade npm before publishing for Trusted Publishing OIDC support ([45ffe0a](https://github.com/Paubox/paubox-cli/commit/45ffe0a250ede746aa5d1efa96a0fdff93a04f52))
* use Node 24 (with bundled npm 11) for publish workflow ([48299ce](https://github.com/Paubox/paubox-cli/commit/48299cee6e81e5eb02b9ba7896b0b16580c4ad09))
* use Node 24 (with bundled npm 11) for publish workflow ([3f42ee1](https://github.com/Paubox/paubox-cli/commit/3f42ee15cb17ea10f4a173dce540c0cd73fc6e1f))

## [0.1.1](https://github.com/Paubox/paubox-cli/compare/paubox-cli-v0.1.0...paubox-cli-v0.1.1) (2026-05-20)

### Bug Fixes

* make local dev and pack reliable ([6cb8236](https://github.com/Paubox/paubox-cli/commit/6cb8236194453da381ba884d8557f93b77bf3823))
* skip POSIX permission assertion on Windows ([e979f2d](https://github.com/Paubox/paubox-cli/commit/e979f2dd8da24e5f25912448258dfa1ea128f4dd))
