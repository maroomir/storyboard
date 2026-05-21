import { cp, mkdir, rm } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const source = path.join(repoRoot, "node_modules", "@seedcoat", "wasm")
const target = path.join(repoRoot, "out", "vendor", "@seedcoat", "wasm")

await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })
await cp(path.join(source, "package.json"), path.join(target, "package.json"))
await cp(path.join(source, "dist"), path.join(target, "dist"), { recursive: true })

console.log(`Copied @seedcoat/wasm dist to ${path.relative(repoRoot, target)}`)
