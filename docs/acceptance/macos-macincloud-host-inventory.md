# macOS remote host inventory (dogfood template)

Operator template for a **clean remote macOS** used for packaging and product dogfood.
Concrete rental hostnames, usernames, and account IDs are intentionally omitted from the
public tree—fill those in a private runbook if needed.

## Purpose

Record baseline emptiness and tool presence before seeding harness history or installing a
packaged Masthead build.

## Baseline checks

| Check | What to record |
| --- | --- |
| OS / arch | e.g. macOS 15+, arm64 |
| Shell home | `$HOME` (note if it is a symlink to another volume) |
| Node | path + version (`node -v`, Homebrew vs official) |
| Xcode / CLT | present for Electron packaging |
| Disk free | prefer >40 GB free on the data volume |
| Masthead | no prior `~/Applications/Masthead.app` or leftover app-support DB unless intentional |
| Harness homes | empty or known seed for `~/.codex`, `~/.claude`, Cursor state, etc. |

## Access patterns (generic)

```bash
# SSH to the remote Mac (configure Host in ~/.ssh/config privately)
ssh <remote-mac>

export PATH="/opt/homebrew/bin:$PATH"
node -v
df -h
```

Optional UI path: vendor RDP/VNC as provided by the cloud Mac host (ports vary).

## After dogfood

Prefer **delete** over archive for multi‑GB seeds and SQLite copies (see repository
local-disk hygiene in `AGENTS.md`). Stop or release the cloud Mac in the vendor control
panel so rental billing ends—logging out of apps alone may not stop the host.

## Related

- [macos-release-build.md](../reference/macos-release-build.md)
- [2026-08-06-macos-dogfood-closeout.md](./2026-08-06-macos-dogfood-closeout.md)
