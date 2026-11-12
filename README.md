<p align="center"><img src="build/icon.svg" width="128" alt="Mendel logo"></p>

# Mendel

Desktop git client (macOS, Windows, Linux) in the spirit of GitHub Desktop, with host-specific **providers** that switch on automatically from a repo's remote. Providers: **Gerrit** (any server ≥ 2.15; tested against a 3.1-shaped mock) and **GitHub** (github.com).

Git work goes through your installed `git`, so SSH keys, `~/.ssh/config`, credential helpers and hooks behave as in the terminal.

## Features
- Repos: open, clone (with cancel), recent list, open in editor / terminal
- Changes: live status, diff, stage/unstage/discard per file or hunk, right-click menu, ignore
- Commit: separate summary + description, amend, 72-column ruler
- Branches, fetch / pull / push, rebase onto upstream, conflict banner (resolve / continue / abort)
- History with commit detail and diffs
- Gerrit: detection, HTTP-password login (OS keychain), **Send for review** (topic, reviewers, WIP), Change-Id added when the hook is missing, new-patchset hints, Reviews list, change detail with side-by-side diff, comment threads, votes, submit / abandon / rebase, checkout a change locally
- GitHub: sign-in with the GitHub App (device flow, OS keychain), open pull requests list and detail, Open on GitHub, check out a same-repo pull request as `pr/<N>`, Create pull request on GitHub
- Git identity and signing (Settings → Git): global form, named profiles assigned per repository through git's own conditional include (the terminal agrees), project-specific values
- Native menus and shortcuts, light/dark theme, in-app update checker
- `mendel .` opens a repo from the terminal (also into a running app): macOS/Linux install it via the menu (Install `mendel` Command…, writes `~/.local/bin/mendel`, no sudo); on Windows run `Mendel.exe <dir>` instead

## Requirements
Node 24+, git ≥ 2.30 (2.50.1+ recommended).

## Run locally
```sh
npm ci
npx install-electron     # .npmrc disables install scripts
npm run dev              # app with hot reload
npm run dist             # packaged app in release/ (unsigned)
```
Unsigned macOS build: first launch with right-click → Open.

## Tests
```sh
npm run typecheck
npm test                 # unit + git integration
npm run e2e              # Playwright against the e2e-mode build
```
Coverage per acceptance criterion and the manual checklist: [docs/TEST-MATRIX.md](docs/TEST-MATRIX.md).

## Docs
- [docs/PLAN.md](docs/PLAN.md): product plan, screens, flows, provider model
- [docs/TECH.md](docs/TECH.md): libraries and the security checklist
- [docs/REVIEW.md](docs/REVIEW.md): review/security findings and their fixes
- [docs/RELEASE.md](docs/RELEASE.md): cutting a release, signing, updates

## Commits
Only `feat(<scope>): <desc>` and `bug(<scope>): <desc>` are accepted (`scripts/commit-msg`; install with `cp scripts/commit-msg .git/hooks/`).
