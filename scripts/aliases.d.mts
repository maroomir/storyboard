/**
 * Bundler alias table built from a project's tsconfig `paths`, keyed by alias prefix and pointing at
 * an absolute path. Consumed by the esbuild, Vite and Vitest configs so those never restate `paths`.
 */
export declare function aliasesFromTsconfig(tsconfigPath: string): Record<string, string>;
