import { $ } from "bun"
import { test, expect } from "bun:test"

const gop = import.meta.dir + "/index.ts"
const tmp = await $`mktemp -d`.text().then(s => s.trim())

test("not a git repo", async () => {
  const r = await $`bun ${gop}`.cwd(tmp).quiet().nothrow()
  expect(r.exitCode).toBe(1)
  expect(r.stderr.toString()).toContain("not a git repository")
})

test("single remote, branch exists on remote", async () => {
  const repo = `${tmp}/a`
  await $`git init -q -b main ${repo}`.quiet()
  await $`git -C ${repo} remote add origin git@github.com:foo/bar.git`.quiet()
  await $`git -C ${repo} commit -q --allow-empty -m init`.quiet()
  await $`git -C ${repo} update-ref refs/remotes/origin/main HEAD`.quiet()
  const r = await $`bun ${gop}`.cwd(repo).env({ ...process.env, GOP_DRY_RUN: "1" }).quiet()
  expect(r.stdout.toString().trim()).toBe("https://github.com/foo/bar/tree/main")
})

test("https remote, branch not on remote falls back to root", async () => {
  const repo = `${tmp}/b`
  await $`git init -q -b dev ${repo}`.quiet()
  await $`git -C ${repo} remote add origin https://github.com/foo/baz`.quiet()
  const r = await $`bun ${gop}`.cwd(repo).env({ ...process.env, GOP_DRY_RUN: "1" }).quiet()
  expect(r.stdout.toString().trim()).toBe("https://github.com/foo/baz")
})
