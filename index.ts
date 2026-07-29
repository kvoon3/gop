#!/usr/bin/env bun
import { $ } from "bun"
import { createCliRenderer, Select, SelectRenderableEvents } from "@opentui/core"

// ponytail: github.com + tangled.org only; self-hosted Tangled knot remotes aren't matched — map their path onto tangled.org when needed
type Candidate = { label: string; url: string; repoDir: string; remote: string }

// Returns the web URL of the repo root, or null if the remote isn't a known platform
function repoWebUrl(url: string): string | null {
  const gh = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/)
  if (gh) return `https://github.com/${gh[1]}/${gh[2]}`
  const tg = url.match(/tangled\.org[:/](.+\/[^/]+?)(?:\.git)?\/?$/)
  if (tg) return `https://tangled.org/${tg[1]}`
  return null
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
  return list.filter(c => repoWebUrl(c.url))
}

async function targetUrl(c: Candidate): Promise<string> {
  const base = repoWebUrl(c.url)
  if (!base) throw new Error("unreachable") // filtered in candidates()
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
  console.error("gop: no supported (GitHub/Tangled) remotes configured")
  process.exit(1)
}

if (list.length === 1) {
  const url = await targetUrl(list[0])
  if (process.env.GOP_DRY_RUN) console.log(url)
  else await open(url)
  process.exit(0)
}

// ponytail: read once at startup, no live switching; non-macOS assumes dark
const dark = process.platform !== "darwin" ||
  (await $`defaults read -g AppleInterfaceStyle`.quiet().nothrow().text()).trim() === "Dark"
const theme = dark
  ? { textColor: "#e5e5e5", descriptionColor: "#888888", selectedBackgroundColor: "#33445e", selectedTextColor: "#ffffff" }
  : { textColor: "#1a1a1a", descriptionColor: "#777777", selectedBackgroundColor: "#d7d7d7", selectedTextColor: "#000000" }

const renderer = await createCliRenderer({ exitOnCtrlC: true })
const menu = Select({
  width: 60,
  height: list.length + 2,
  options: list.map(c => ({ name: c.label, description: c.url })),
  ...theme,
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
