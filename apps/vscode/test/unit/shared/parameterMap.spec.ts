import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { describe, expect, it } from "vitest"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..")

function trackedParameterFiles(): readonly string[] {
  const listed = execFileSync("git", ["ls-files", "*.params.json"], {
    cwd: repoRoot,
    encoding: "utf8"
  })

  return listed.split("\n").filter((line) => line.length > 0)
}

describe("parameter map", () => {
  const parameterFiles = trackedParameterFiles()

  it("finds every tunable data file through the shared suffix", () => {
    expect(parameterFiles.length).toBeGreaterThan(0)
  })

  it("names every parameter file in the rules map", () => {
    const rules = readFileSync(path.join(repoRoot, ".claude/rules/coding-standards.md"), "utf8")

    for (const file of parameterFiles) {
      expect(rules, `${file} is missing from the parameter map`).toContain(file)
    }
  })

  it("keeps a sibling schema that loads each parameter file", () => {
    for (const file of parameterFiles) {
      const schemaPath = path.join(repoRoot, file.replace(/\.params\.json$/, ".ts"))
      const schema = readFileSync(schemaPath, "utf8")

      expect(schema, `${file} has no schema that parses it`).toContain(path.basename(file))
      expect(schema, `${file} is loaded without a zod schema`).toContain(".parse(")
    }
  })
})
