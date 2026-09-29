// Packages `dist/` (bundled main, preload and page, plus the app manifest the build writes there)
// into the installers the release ships. Signing is opt-in by environment so a machine without the
// certificates still produces working, unsigned installers:
//   macOS   CSC_LINK / CSC_KEY_PASSWORD (Developer ID Application .p12)
//           APPLE_API_KEY (path to the .p8) / APPLE_API_KEY_ID / APPLE_API_ISSUER for notarization
//   Windows WIN_CSC_LINK / WIN_CSC_KEY_PASSWORD (code-signing .pfx)
const electronVersion = require('electron/package.json').version;

const canNotarize = Boolean(
  process.env.APPLE_API_KEY && process.env.APPLE_API_KEY_ID && process.env.APPLE_API_ISSUER,
);

module.exports = {
  appId: 'com.webfic.storyboard',
  productName: 'Storyboard',
  electronVersion,
  directories: {
    app: 'dist',
    output: 'release',
    buildResources: 'build',
  },
  // Main and preload are bundled with every dependency inlined, so nothing from node_modules ships.
  // Without this exclusion electron-builder walks up to the monorepo's node_modules and packs all of it.
  files: ['**/*', '!**/*.map', '!**/node_modules/**'],
  npmRebuild: false,
  asar: true,
  artifactName: 'storyboard-desktop-${version}-${os}-${arch}.${ext}',
  mac: {
    category: 'public.app-category.productivity',
    icon: 'build/icon.png',
    hardenedRuntime: true,
    notarize: canNotarize,
    // Auto-update on macOS reads the zip; the dmg is what a person downloads.
    target: [
      { target: 'dmg', arch: ['arm64'] },
      { target: 'zip', arch: ['arm64'] },
    ],
  },
  dmg: {
    artifactName: 'storyboard-desktop-${version}-mac-${arch}.${ext}',
  },
  win: {
    icon: 'build/icon.png',
    target: [{ target: 'nsis', arch: ['x64'] }],
  },
  nsis: {
    artifactName: 'storyboard-desktop-${version}-win-${arch}-setup.${ext}',
    oneClick: false,
    perMachine: false,
    allowToChangeInstallationDirectory: true,
  },
  // The update feed is the public repository's releases, where every `v*` tag is published.
  publish: [{ provider: 'github', owner: 'webfic', repo: 'storyboard', releaseType: 'release' }],
};
