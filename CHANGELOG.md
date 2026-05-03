# Changelog

All notable changes to Storyboard will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
after the first public release.

## [Unreleased]

### Added

- Established the repository baseline for the Storyboard VSCode extension.
- Added the initial TypeScript and esbuild extension-host scaffold.
- Added the `storyboard.helloWorld` sanity-check command.
- Added VSCode launch/tasks configuration for F5 extension debugging.
- Added ESLint and Prettier baseline configuration.
- Added the `storyboard.init` command for creating a Storyboard workspace structure.
- Added project metadata validation for `.storyboard/project.json`.
- Added extension-host workspace, path convention, and logger modules.
- Added the Storyboard Activity Bar container and sidebar placeholder view.
- Added a minimal Vite and React webview UI build.
- Added `.card` YAML schemas, round-trip tests, and a Storyboard card custom editor.
- Added Characters and Backgrounds sidebar views with file watching and card opening.
- Added commands for creating character and background cards from the sidebar.
- Added Storyboard AI provider configuration keys with `mock` as the default provider.
- Added SecretStorage-backed API key management and the `Storyboard: Set API Key...` command.
- Added testable `SecretStore` and `ConfigBridge` adapters for Phase 3 AI integration.

### Changed

- Slimmed Phase 0 to focus on repository readiness instead of Picktion compatibility fixtures.
- Updated packaging scripts so `npm run build` bundles both the extension host and webview UI.