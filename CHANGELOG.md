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

### Changed

- Slimmed Phase 0 to focus on repository readiness instead of Picktion compatibility fixtures.