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

const palettes = {
  dark: { backgroundColor: "transparent", textColor: "#e5e5e5", descriptionColor: "#888888", focusedBackgroundColor: "transparent", focusedTextColor: "#e5e5e5", selectedBackgroundColor: "#33445e", selectedTextColor: "#ffffff", selectedDescriptionColor: "#aaaaaa" },
  light: { backgroundColor: "transparent", textColor: "#1a1a1a", descriptionColor: "#777777", focusedBackgroundColor: "transparent", focusedTextColor: "#1a1a1a", selectedBackgroundColor: "#d7d7d7", selectedTextColor: "#000000", selectedDescriptionColor: "#555555" },
}

function wrapText(text: string, width: number): string[] {
  if (width <= 0) return [""]
  const lines: string[] = []
  for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width))
  return lines
}

const renderer = await createCliRenderer({ exitOnCtrlC: true, screenMode: "main-screen" })
const descW = Math.max(1, renderer.width - 4)
const lpi = 1 + Math.max(1, ...list.map(c => Math.ceil(c.url.length / descW)))
const menu = Select({
  width: renderer.width,
  height: Math.min(list.length * lpi + 2, renderer.height),
  options: list.map(c => ({ name: c.label, description: c.url })),
  wrapSelection: true,
  keyBindings: [
    { name: "n", ctrl: true, action: "move-down" },
    { name: "p", ctrl: true, action: "move-up" },
  ],
})
;(menu as any).linesPerItem = lpi
;(menu as any).maxVisibleItems = Math.max(1, Math.floor(menu.height / lpi))

;(menu as any).refreshFrameBuffer = function () {
  const self = this as any
  if (!self.frameBuffer) return
  self.frameBuffer.clear(self._focused ? self._focusedBackgroundColor : self._backgroundColor)
  if (self._options.length === 0) return
  const w = Math.max(0, self.width - 4)
  const opts = self._options.slice(self.scrollOffset, self.scrollOffset + self.maxVisibleItems)
  for (let i = 0; i < opts.length; i++) {
    const idx = self.scrollOffset + i
    const opt = opts[i]
    const sel = idx === self._selectedIndex
    const y = i * self.linesPerItem
    if (y + self.linesPerItem - 1 >= self.height) break
    if (sel) self.frameBuffer.fillRect(0, y, self.width, self.linesPerItem - self._itemSpacing, self._selectedBackgroundColor)
    const ind = self._showSelectionIndicator ? sel ? "▶ " : "  " : ""
    const nc = sel ? self._selectedTextColor : (self._focused ? self._focusedTextColor : self._textColor)
    self.frameBuffer.drawText(`${ind}${opt.name}`, 1, y, nc)
    if (self._showDescription) {
      const dc = sel ? self._selectedDescriptionColor : self._descriptionColor
      const tx = 1 + (self._showSelectionIndicator ? 2 : 0)
      for (const [j, line] of wrapText(opt.description, w).entries()) {
        if (y + 1 + j < self.height) self.frameBuffer.drawText(line, tx, y + 1 + j, dc)
      }
    }
  }
  if (self._showScrollIndicator && self._options.length > self.maxVisibleItems) {
    self.renderScrollIndicatorToFrameBuffer(0, 0, self.width, self.height)
  }
}

renderer.on("resize", () => {
  menu.width = renderer.width
  const w = Math.max(1, renderer.width - 4)
  const newLpi = 1 + Math.max(1, ...list.map(c => Math.ceil(c.url.length / w)))
  ;(menu as any).linesPerItem = newLpi
  menu.height = Math.min(list.length * newLpi + 2, renderer.height)
  ;(menu as any).maxVisibleItems = Math.max(1, Math.floor(menu.height / newLpi))
  menu.options = list.map(c => ({ name: c.label, description: c.url }))
})
const applyTheme = (mode: "dark" | "light" | null) => Object.assign(menu, palettes[mode ?? "dark"])
applyTheme(await renderer.waitForThemeMode())
renderer.on("theme_mode", applyTheme)
menu.on(SelectRenderableEvents.ITEM_SELECTED, async (i: number) => {
  const url = await targetUrl(list[i])
  renderer.destroy()
  if (process.env.GOP_DRY_RUN) console.log(url)
  else await open(url)
  process.exit(0)
})
renderer.keyInput.on("keypress", key => {
  if (key.name === "escape" || (!key.ctrl && !key.meta && key.name === "q")) { renderer.destroy(); process.exit(0) }
})
menu.focus()
renderer.root.add(menu)
