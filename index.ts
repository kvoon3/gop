#!/usr/bin/env bun
import { $ } from "bun"
import { createCliRenderer, Select, SelectRenderableEvents } from "@opentui/core"

type Candidate = { label: string; url: string; repoDir: string; remote: string }

// ponytail: GitHub-only; generalize to {host, owner, repo} per-platform when a second platform lands
function parseGithub(url: string): { owner: string; repo: string } | null {
  const m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
  return m ? { owner: m[1], repo: m[2] } : null
}

async function remotesOf(repoDir: string, suffix = ""): Promise<Candidate[]> {
  const names = (await $`git -C ${repoDir} remote`.quiet().text()).trim().split("\n").filter(Boolean)
  const out: Candidate[] = []
  for (const name of names) {
    const url = (await $`git -C ${repoDir} remote get-url ${name}`.quiet().text()).trim()
    out.push({ label: name + suffix, url, repoDir, remote: name })
  }
  return out
}

async function candidates(): Promise<Candidate[]> {
  const root = (await $`git rev-parse --show-toplevel`.quiet().text()).trim()
  const list = await remotesOf(root)
  const submodules = (await $`git -C ${root} submodule foreach --quiet 'echo $sm_path'`.quiet().nothrow().text())
    .split("\n").map(s => s.trim()).filter(Boolean)
  for (const sm of submodules) list.push(...await remotesOf(`${root}/${sm}`, ` (${sm})`))
  return list.filter(c => parseGithub(c.url))
}

async function targetUrl(c: Candidate): Promise<string> {
  const gh = parseGithub(c.url)
  if (!gh) throw new Error("unreachable") // filtered in candidates()
  const base = `https://github.com/${gh.owner}/${gh.repo}`
  const branch = (await $`git -C ${c.repoDir} branch --show-current`.quiet().text()).trim()
  if (!branch) return base // detached HEAD
  const exists = (await $`git -C ${c.repoDir} rev-parse --verify --quiet refs/remotes/${c.remote}/${branch}`.quiet().nothrow()).exitCode
  return exists === 0 ? `${base}/tree/${branch}` : base
}

async function open(url: string) {
  const cmd = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url]
  await Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).exited
}

const list = await candidates().catch(() => {
  console.error("gop: not a git repository")
  process.exit(1)
})
if (list.length === 0) {
  console.error("gop: no GitHub remotes configured")
  process.exit(1)
}

if (list.length === 1) {
  const url = await targetUrl(list[0])
  if (process.env.GOP_DRY_RUN) console.log(url)
  else await open(url)
  process.exit(0)
}

const renderer = await createCliRenderer({ exitOnCtrlC: true })
const menu = Select({
  width: 60,
  height: list.length + 2,
  options: list.map(c => ({ name: c.label, description: c.url })),
})
menu.on(SelectRenderableEvents.ITEM_SELECTED, async (i: number) => {
  const url = await targetUrl(list[i])
  renderer.destroy()
  if (process.env.GOP_DRY_RUN) console.log(url)
  else await open(url)
  process.exit(0)
})
renderer.keyInput.on("keypress", key => {
  if (key.name === "escape") { renderer.destroy(); process.exit(0) }
})
menu.focus()
renderer.root.add(menu)
