import path from "path"
import type { Workspace } from "./workspace.js"

/**
 * Per-repo knowledge the agent needs but should never guess:
 * setup commands, verification commands and human-written instructions.
 * Sources (highest priority first): platform RepoConfig override → .pullwright/config.json → detection.
 */

export type RepoConfig = {
  setup: string[]
  verify: string[]
  instructions: string
  packageDirs: string[]
}

export type RepoConfigOverride = { setup?: string[]; verify?: string[]; instructions?: string }

const INSTRUCTION_FILES = ["AGENTS.md", ".pullwright/instructions.md", "CLAUDE.md", ".cursorrules", ".github/copilot-instructions.md"]

async function readJson(ws: Workspace, p: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await ws.read(p)) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function detectRepoConfig(ws: Workspace, override?: RepoConfigOverride): Promise<RepoConfig> {
  const files = await ws.listFiles()
  const fileSet = new Set(files)
  const pkgDirs = files
    .filter((f) => f.endsWith("package.json") && !f.includes("node_modules/") && f.split("/").length <= 3)
    .map((f) => path.posix.dirname(f))
    .sort((a, b) => a.split("/").length - b.split("/").length)

  const setup: string[] = []
  const verify: string[] = []
  for (const dir of pkgDirs) {
    const pj = await readJson(ws, dir === "." ? "package.json" : `${dir}/package.json`)
    if (!pj) continue
    const scripts = (pj.scripts ?? {}) as Record<string, string>
    const deps = { ...((pj.dependencies ?? {}) as object), ...((pj.devDependencies ?? {}) as object) } as Record<string, string>
    const cd = dir === "." ? "" : `cd ${dir} && `
    const hasDeps = Object.keys(deps).length > 0
    const lock = (n: string) => fileSet.has(dir === "." ? n : `${dir}/${n}`)
    if (hasDeps) {
      if (lock("pnpm-lock.yaml")) setup.push(`${cd}corepack pnpm install --frozen-lockfile`)
      else if (lock("yarn.lock")) setup.push(`${cd}corepack yarn install --frozen-lockfile`)
      else if (lock("package-lock.json")) setup.push(`${cd}npm ci --no-audit --no-fund --loglevel=error`)
      else setup.push(`${cd}npm install --no-audit --no-fund --loglevel=error`)
      if (deps["prisma"] || deps["@prisma/client"]) setup.push(`${cd}npx prisma generate >/dev/null 2>&1 || true`)
    }
    const typecheck = ["typecheck", "type-check", "check-types", "tsc"].find((s) => scripts[s])
    const tsconfig = fileSet.has(dir === "." ? "tsconfig.json" : `${dir}/tsconfig.json`)
    if (typecheck) verify.push(`${cd}npm run -s ${typecheck}`)
    else if (tsconfig && deps["typescript"]) {
      // Project references (tsc -b) need build mode; plain projects use --noEmit.
      const tc = await ws.read(dir === "." ? "tsconfig.json" : `${dir}/tsconfig.json`).catch(() => "")
      verify.push(/"references"\s*:/.test(tc) ? `${cd}npx tsc -b` : `${cd}npx tsc --noEmit -p .`)
    }
    const test = scripts["test"]
    if (test && !/no test specified/.test(test) && !/\bwatch\b/.test(test)) {
      verify.push(/vitest(?!\s+run)/.test(test) && !/\brun\b/.test(test) ? `${cd}npx vitest run` : `${cd}npm test --silent`)
    }
  }
  if (fileSet.has("pyproject.toml") || fileSet.has("setup.py") || fileSet.has("requirements.txt")) {
    if (fileSet.has("requirements.txt")) setup.push("pip install -q -r requirements.txt --user 2>&1 | tail -2 || true")
    if (files.some((f) => /(^|\/)(test_[^/]+|[^/]+_test)\.py$/.test(f))) verify.push("python3 -m pytest -q -x 2>&1 | tail -30")
    else verify.push("python3 -m compileall -q . >/dev/null")
  }

  const cfg = await readJson(ws, ".pullwright/config.json")
  const fromFile = {
    setup: Array.isArray(cfg?.setup) ? (cfg!.setup as unknown[]).map(String) : undefined,
    verify: Array.isArray(cfg?.verify) ? (cfg!.verify as unknown[]).map(String) : undefined,
  }
  if (fileSet.has(".pullwright/setup.sh")) setup.splice(0, setup.length, "bash .pullwright/setup.sh")

  let instructions = ""
  for (const f of INSTRUCTION_FILES) {
    if (!fileSet.has(f)) continue
    const txt = (await ws.read(f).catch(() => "")).trim()
    if (txt) instructions += `### ${f}\n${txt.slice(0, 4000)}\n\n`
    if (instructions.length > 6000) break
  }

  return {
    setup: override?.setup ?? fromFile.setup ?? setup,
    verify: override?.verify ?? fromFile.verify ?? verify,
    instructions: (override?.instructions ? `### Platform notes\n${override.instructions}\n\n` : "") + instructions.slice(0, 6000),
    packageDirs: pkgDirs,
  }
}
