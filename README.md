# gop

Open the current git repo (or submodule) on GitHub, on the current branch.

```
gop
```

- 0 remotes → error. 1 GitHub remote → opens instantly. 2+ (incl. submodule remotes) → TUI picker (j/k/arrows, Enter, Esc).
- Opens `/tree/<branch>` when the branch exists on that remote, else repo root.
- `GOP_DRY_RUN=1` prints the URL instead of opening it.

Install: `ln -s "$PWD/index.ts" ~/bin/gop` (needs [bun](https://bun.sh) + `bun install` here once).
