export interface RuntimeManifest {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly license?: string;
  readonly engines?: Record<string, string>;
  readonly main?: string;
  readonly bin?: Record<string, string>;
  readonly dependencies: Record<string, string>;
}

/**
 * Trims an app's source package.json to what a release tarball needs: identity fields plus the
 * bundle's runtime externals, each carrying the range the source manifest declares.
 * Throws when an external is not declared in `dependencies`.
 */
export declare function createRuntimeManifest(
  sourceManifest: Record<string, unknown>,
  externals: readonly string[],
): RuntimeManifest;

/** Writes the runtime manifest to `<packageRoot>/dist/package.json` and returns that path. */
export declare function writeRuntimeManifest(packageRoot: string, externals: readonly string[]): string;
