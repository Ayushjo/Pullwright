import { execFile } from "child_process"
import { promisify } from "util"
import { mkdir, rm, writeFile } from "fs/promises"
import path from "path"
import os from "os"
import { Octokit } from "octokit"

const execFileP = promisify(execFile)

/**
 * Host-side git + GitHub operations. The GitHub token only ever lives in this process:
 * it is passed to git through GIT_CONFIG_* env vars (never argv, never .git/config),
 * so the sandbox — which only sees the working tree and a read-only .git — can't read it.
 */

const AGENT_NAME = "Pullwright Agent"
const AGENT_EMAIL = "agent@pullwright.dev"

export function tasksRoot(): string {
  return process.env.TASKS_DIR ?? path.join(os.tmpdir(), "pullwright-tasks")
}

function authEnv(token?: string): NodeJS.ProcessEnv {
  const base: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
    GIT_AUTHOR_NAME: AGENT_NAME,
    GIT_AUTHOR_EMAIL: AGENT_EMAIL,
    GIT_COMMITTER_NAME: AGENT_NAME,
    GIT_COMMITTER_EMAIL: AGENT_EMAIL,
  }
  if (!token) return base
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64")
  return {
    ...base,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  }
}

export async function git(cwd: string, args: string[], token?: string, input?: string): Promise<string> {
  try {
    const p = execFileP("git", args, { cwd, env: authEnv(token), maxBuffer: 64 * 1024 * 1024 })
    if (input !== undefined) p.child.stdin?.end(input)
    const { stdout } = await p
    return stdout
  } catch (err) {
    const e = err as { stderr?: string; message: string }
    throw new Error(redact(`git ${args[0]} failed: ${e.stderr || e.message}`))
  }
}

export function redact(s: string): string {
  return s
    .replace(/(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, "[REDACTED]")
    .replace(/x-access-token:[^@\s]+@/g, "x-access-token:[REDACTED]@")
    .replace(/(sk-(proj-|ant-|or-)?[A-Za-z0-9_-]{16,})/g, "[REDACTED]")
    .replace(PROVIDER_KEY, "[REDACTED]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/g, "$1[REDACTED]")
    .replace(/AUTHORIZATION: basic [A-Za-z0-9+/=]+/gi, "AUTHORIZATION: basic [REDACTED]")
}

/**
 * Model-provider key formats (users paste these into the wallet; providers sometimes echo them in errors):
 * Google (AIza…, AQ.…), Groq gsk_, Vercel AI Gateway vck_, NVIDIA nvapi-, Hugging Face hf_, xAI xai-,
 * Cerebras csk-, Perplexity pplx-, Together tgp_v1_, Fireworks fw_, Replicate r8_.
 * Keys without a prefix (e.g. Mistral) are covered by exact-match redaction of stored credentials.
 */
const PROVIDER_KEY =
  /\b(AIza[0-9A-Za-z_-]{30,}|AQ\.[A-Za-z0-9_-]{20,}|gsk_[A-Za-z0-9]{20,}|vck_[A-Za-z0-9]{20,}|nvapi-[A-Za-z0-9_-]{20,}|hf_[A-Za-z0-9]{20,}|xai-[A-Za-z0-9]{20,}|csk-[A-Za-z0-9]{20,}|pplx-[A-Za-z0-9]{20,}|tgp_v1_[A-Za-z0-9_-]{20,}|fw_[A-Za-z0-9]{20,}|r8_[A-Za-z0-9]{20,})/g

export type RepoRef = { owner: string; repo: string; issueNumber: number }

export function parseIssueUrl(url: string): RepoRef {
  const m = url.trim().match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)\/?(?:[?#].*)?$/)
  if (!m) throw new Error("Not a GitHub issue URL (expected https://github.com/<owner>/<repo>/issues/<number>)")
  return { owner: m[1]!, repo: m[2]!, issueNumber: Number(m[3]) }
}

export async function cloneForTask(ref: RepoRef, branch: string, dest: string, token?: string): Promise<string> {
  await rm(dest, { recursive: true, force: true })
  await mkdir(path.dirname(dest), { recursive: true })
  const url = `https://github.com/${ref.owner}/${ref.repo}.git`
  await git(path.dirname(dest), ["clone", "--quiet", "--depth", "1", "--single-branch", "--branch", branch, url, dest], token)
  // No credentials are stored; make sure nothing in the clone references a token.
  await git(dest, ["remote", "set-url", "origin", url])
  return (await git(dest, ["rev-parse", "HEAD"])).trim()
}

/** Eval mode: clone a local repository (no network, no credentials). */
export async function cloneLocal(repoPath: string, dest: string): Promise<{ baseSha: string; branch: string }> {
  await rm(dest, { recursive: true, force: true })
  await mkdir(path.dirname(dest), { recursive: true })
  await git(path.dirname(dest), ["clone", "--quiet", "--depth", "1", `file://${repoPath}`, dest])
  const branch = (await git(dest, ["rev-parse", "--abbrev-ref", "HEAD"])).trim()
  return { baseSha: (await git(dest, ["rev-parse", "HEAD"])).trim(), branch }
}

/** Everything changed vs `base`, including untracked files, as a binary-safe patch. */
export async function diffVs(cwd: string, base: string): Promise<string> {
  await git(cwd, ["add", "-A"])
  return git(cwd, ["diff", "--cached", "--binary", "--no-color", base])
}

export type FileStat = { path: string; added: number; removed: number; status: "A" | "M" | "D" | "R" }

export async function diffStat(cwd: string, base: string): Promise<FileStat[]> {
  await git(cwd, ["add", "-A"])
  const num = await git(cwd, ["diff", "--cached", "--numstat", "--no-renames", base])
  const names = await git(cwd, ["diff", "--cached", "--name-status", "--no-renames", base])
  const status = new Map<string, FileStat["status"]>()
  for (const l of names.split("\n").filter(Boolean)) {
    const [s, p] = l.split("\t")
    if (p) status.set(p, (s?.[0] as FileStat["status"]) ?? "M")
  }
  return num
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [a, r, p] = l.split("\t")
      return { path: p ?? "", added: a === "-" ? 0 : Number(a), removed: r === "-" ? 0 : Number(r), status: status.get(p ?? "") ?? "M" }
    })
}

/** Cline-v4-style checkpoint: snapshot the working tree to a private ref without moving HEAD. */
export async function checkpoint(cwd: string, taskId: string, label: string, parent: string): Promise<string> {
  await git(cwd, ["add", "-A"])
  const tree = (await git(cwd, ["write-tree"])).trim()
  const commit = (await git(cwd, ["commit-tree", tree, "-p", parent, "-m", `pullwright checkpoint: ${label}`])).trim()
  await git(cwd, ["update-ref", `refs/pullwright/${taskId}/${label}`, commit])
  return commit
}

/** Restore the working tree to a checkpoint (tracked + new files). */
export async function restoreCheckpoint(cwd: string, sha: string): Promise<void> {
  await git(cwd, ["read-tree", "-u", "--reset", sha])
  await git(cwd, ["clean", "-fdq"])
}

/**
 * GitHub client. Without a token it is unauthenticated (public repos only) — it never silently uses
 * the operator's GITHUB_TOKEN for a user's task; only operator/eval tasks opt into that.
 */
export function octokit(token?: string, operatorFallback = false) {
  const auth = token ?? (operatorFallback ? process.env.GITHUB_TOKEN : undefined)
  return new Octokit(auth ? { auth } : {})
}

export async function fetchIssue(ref: RepoRef, token?: string, operatorFallback = false) {
  const ok = octokit(token, operatorFallback)
  // format "full" adds body_html, whose attachment URLs are signed for 300 s (the only route to images
  // in private repos) — download them right after this call (intake/attachments.ts).
  const full = { mediaType: { format: "full" } }
  const [{ data: issue }, { data: repo }, comments] = await Promise.all([
    ok.rest.issues.get({ owner: ref.owner, repo: ref.repo, issue_number: ref.issueNumber, ...full }),
    ok.rest.repos.get({ owner: ref.owner, repo: ref.repo }),
    ok.rest.issues
      .listComments({ owner: ref.owner, repo: ref.repo, issue_number: ref.issueNumber, per_page: 20, ...full })
      .then((r) => r.data)
      .catch(() => []),
  ])
  if (issue.pull_request) throw new Error("That URL is a pull request, not an issue")
  const human = comments.filter((c) => !c.user?.type || c.user.type !== "Bot")
  return {
    title: issue.title,
    body: issue.body ?? "",
    bodyHtml: issue.body_html ?? "",
    commentsHtml: human.map((c) => ({ body: c.body ?? "", html: c.body_html ?? "" })),
    comments: human.map((c) => `@${c.user?.login ?? "someone"}: ${c.body ?? ""}`),
    labels: issue.labels.map((l) => (typeof l === "string" ? l : (l.name ?? ""))).filter(Boolean),
    defaultBranch: repo.default_branch,
    isPrivate: repo.private,
    canPush: Boolean(repo.permissions?.push),
  }
}

export type PublishInput = {
  ref: RepoRef
  token?: string
  baseBranch: string
  baseSha: string
  patch: string
  branchPrefix?: string
  title: string
  body: string
  draft: boolean
  workDir: string
}

/**
 * OpenHands-resolver-style publish: apply the reviewed patch to a *fresh* clone,
 * commit, push a new branch and open a (draft) PR. The token is only used here.
 */
export async function publishPatch(p: PublishInput): Promise<{ prUrl: string; branch: string; prNumber: number }> {
  if (!p.patch.trim()) throw new Error("Refusing to publish an empty patch")
  if (!p.token) throw new Error("No GitHub token for this task — sign in again and click Publish")
  const ok = octokit(p.token)
  const base = `${p.branchPrefix ?? "pullwright"}/issue-${p.ref.issueNumber}`
  let branch = base
  for (let k = 2; k < 50; k++) {
    const exists = await ok.rest.git
      .getRef({ owner: p.ref.owner, repo: p.ref.repo, ref: `heads/${branch}` })
      .then(() => true)
      .catch(() => false)
    if (!exists) break
    branch = `${base}-${k}`
  }
  const dir = p.workDir
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const url = `https://github.com/${p.ref.owner}/${p.ref.repo}.git`
  await git(dir, ["init", "-q"])
  await git(dir, ["remote", "add", "origin", url])
  await git(dir, ["fetch", "-q", "--depth", "1", "origin", p.baseSha], p.token).catch(async () => {
    await git(dir, ["fetch", "-q", "--depth", "1", "origin", p.baseBranch], p.token)
  })
  await git(dir, ["checkout", "-q", "-b", branch, "FETCH_HEAD"])
  const patchFile = path.join(dir, "..", `${path.basename(dir)}.patch`)
  await writeFile(patchFile, p.patch)
  try {
    await git(dir, ["apply", "--index", "--whitespace=nowarn", patchFile])
  } catch {
    // base moved: try a 3-way apply
    await git(dir, ["apply", "--index", "--3way", "--whitespace=nowarn", patchFile])
  } finally {
    await rm(patchFile, { force: true })
  }
  const staged = (await git(dir, ["diff", "--cached", "--name-only"])).trim()
  if (!staged) throw new Error("Patch produced no changes on the base branch — nothing to publish")
  await git(dir, ["commit", "-q", "-m", `${p.title}\n\nCloses #${p.ref.issueNumber}`])
  await git(dir, ["push", "-q", "origin", `HEAD:refs/heads/${branch}`], p.token)
  const { data: pr } = await ok.rest.pulls.create({
    owner: p.ref.owner,
    repo: p.ref.repo,
    head: branch,
    base: p.baseBranch,
    title: p.title,
    body: p.body,
    draft: p.draft,
  })
  await rm(dir, { recursive: true, force: true })
  return { prUrl: pr.html_url, branch, prNumber: pr.number }
}
