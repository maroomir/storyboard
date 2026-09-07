// Native addon: it must stay a runtime require, not be inlined. Anything listed here also becomes a
// dependency of the release tarball's package.json, so the installer knows to npm-install it.
export const bundleExternals = ['better-sqlite3'];
