import { join } from "node:path"
import { pathToFileURL } from "node:url"

import type {
  Capabilities,
  EncodeOptions,
  HeaderInfo,
  SeedError,
  SeedParts
} from "@seedcoat/wasm"

export type { Capabilities, EncodeOptions, HeaderInfo, SeedError, SeedErrorCode, SeedParts } from "@seedcoat/wasm"

type SeedCoatApi = typeof import("@seedcoat/wasm")

let cachedApi: Promise<SeedCoatApi> | undefined
let seedErrorClass: typeof SeedError | undefined

// NOTE: @seedcoat/wasm is ESM-only and loads seedcoat.wasm relative to its own dist/.
// The extension bundle is CJS (esbuild) and ships the package under out/vendor (see scripts/copy-seedcoat.mjs),
// so we import the copied entry by file URL. The Function wrapper keeps esbuild from down-leveling import() to require().
// In vitest (process.env.VITEST), vite resolves the package from node_modules directly, so no Function wrapping needed.
function importSeedCoat(): Promise<SeedCoatApi> {
  if (process.env.VITEST) {
    return import("@seedcoat/wasm") as unknown as Promise<SeedCoatApi>
  }
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string
  ) => Promise<SeedCoatApi>
  const entryUrl = pathToFileURL(
    join(__dirname, "vendor", "@seedcoat", "wasm", "dist", "index.js")
  ).href
  return dynamicImport(entryUrl)
}

async function getSeedCoatApi(): Promise<SeedCoatApi> {
  if (!cachedApi) {
    cachedApi = (async (): Promise<SeedCoatApi> => {
      const api = await importSeedCoat()
      await api.loadSeedCoat()
      seedErrorClass = api.SeedError
      return api
    })()
  }

  return cachedApi
}

export async function loadSeedCoat(): Promise<void> {
  await getSeedCoatApi()
}

export async function readSeedCoatCapabilities(): Promise<Capabilities> {
  const api = await getSeedCoatApi()
  return api.version()
}

export async function encode(
  parts: SeedParts,
  passphrase: string,
  options?: EncodeOptions
): Promise<Uint8Array> {
  const api = await getSeedCoatApi()
  return api.encode(parts, passphrase, options)
}

export async function decode(container: Uint8Array, passphrase: string): Promise<SeedParts> {
  const api = await getSeedCoatApi()
  return api.decode(container, passphrase)
}

export async function validate(parts: SeedParts): Promise<void> {
  const api = await getSeedCoatApi()
  await api.validate(parts)
}

export async function inspectHeader(container: Uint8Array): Promise<HeaderInfo> {
  const api = await getSeedCoatApi()
  return api.inspectHeader(container)
}

export function isSeedError(error: unknown): error is SeedError {
  if (seedErrorClass !== undefined && error instanceof seedErrorClass) {
    return true
  }

  return error instanceof Error && typeof (error as { code?: unknown }).code === "string"
}
