# Test matrix (PLAN.md §8)

Every acceptance bullet → the test(s) that cover it. `e2e/` = Playwright against the built app (`npm run e2e`), `integration/` / `unit/` = vitest (`npm test`). "manual" = see the checklist at the end.

Status: 49 bullets, 48 covered by automation, 1 partly manual (OS theme switch), 0 missing.

## App shell / security
| Bullet | Test |
|---|---|
| Renderer has no `require`/`process`; only the typed IPC surface | e2e/smoke.spec.ts: window opens hardened with welcome screen and typed api |
| Git missing → blocking card; git ≥ 2.30 → version line | e2e/smoke.spec.ts: missing git shows blocking card with recheck; …hardened… (version line) |

## Repos
| Bullet | Test |
|---|---|
| Subfolder → top-level opens; in recents; relaunch reopens | e2e/repo.spec.ts: open a repo subfolder opens the top level, adds to recents and reopens on relaunch; integration/repo.test.ts |
| Non-repo → "Not a git repository", recents unchanged | e2e/repo.spec.ts: non-repo folder shows "Not a git repository"… |
| Clone opens on Changes; cancel leaves no partial folder; non-empty target errors | e2e/clone.spec.ts; e2e/journeys.spec.ts: generic…; integration/clone.test.ts: cancel mid-clone leaves no partial folder (cancel not driven through the UI) |
| Recent with deleted path → greyed, Locate/Remove | e2e/repo.spec.ts: recent entry with deleted path… |

## Changes & diff
| Bullet | Test |
|---|---|
| M/A/D/R within 2 s (watcher) or on Mod+R | e2e/changes.spec.ts: watcher lists M/A/D/R… (2 s timeout); e2e/native.spec.ts: menu accelerators… (`status:refresh`) |
| File diff; binary → "Binary file changed" | e2e/changes.spec.ts; integration/changes.test.ts: diffs unstaged, staged, untracked and binary files |
| Stage / unstage file matches `git diff --cached` | e2e/staging.spec.ts; integration/staging.test.ts |
| Stage one hunk of two; unstage hunk reverts | e2e/staging.spec.ts; e2e/journeys.spec.ts: generic…; integration/staging.test.ts |
| Discard file / hunk with confirm; cancel → no change | e2e/discard.spec.ts; integration/discard.test.ts |

## Commit
| Bullet | Test |
|---|---|
| Summary + description → `%B` | e2e/commit.spec.ts; e2e/journeys.spec.ts: generic…; integration/commit.test.ts |
| Commit disabled with empty summary / nothing staged | e2e/commit.spec.ts |
| Amend: HEAD replaced, prefilled, count unchanged | e2e/commit.spec.ts; integration/commit.test.ts: amend replaces HEAD… |
| Failing commit-msg hook → stderr shown, message kept | e2e/commit.spec.ts; integration/commit.test.ts |

## Branches
| Bullet | Test |
|---|---|
| Create from current → switched; clean switch | e2e/branch.spec.ts; integration/branch.test.ts |
| Conflicting dirty switch → Stash & switch → restore banner → Restore | e2e/branch.spec.ts; integration/branch.test.ts: conflicting dirty tree… |
| Delete non-current (confirm); current has no delete | e2e/branch.spec.ts; integration/branch.test.ts |

## Sync
| Bullet | Test |
|---|---|
| Ahead 1 → `Push ↑1` → remote has it, ahead 0 | e2e/sync.spec.ts; e2e/journeys.spec.ts: generic…; integration/sync.test.ts |
| Remote ahead → fetch → `Pull ↓N` | e2e/sync.spec.ts; integration/sync.test.ts |
| Diverged → push rejected → banner with Pull | e2e/sync.spec.ts; e2e/journeys.spec.ts: conflict… |
| No upstream → Publish branch | e2e/sync.spec.ts; integration/sync.test.ts |
| Askpass modal; Cancel ends op < 5 s | e2e/askpass.spec.ts (both); e2e/sync.spec.ts: cancelling an auth prompt during fetch…; integration/askpass.test.ts |

## History
| Bullet | Test |
|---|---|
| Newest first; selection shows message, files, diff | e2e/history.spec.ts; e2e/journeys.spec.ts: generic…; integration/log.test.ts |
| 500 commits: first page < 1 s, paging | e2e/history.spec.ts: 500-commit history…; integration/log.test.ts |

## Conflicts
| Bullet | Test |
|---|---|
| Pull/rebase conflict → banner; Mark resolved + Continue; Abort restores HEAD | e2e/conflicts.spec.ts; e2e/journeys.spec.ts: conflict…; e2e/rebase.spec.ts: conflict case; e2e/conflicted-file.spec.ts; integration/conflict.test.ts (merge + rebase continue/abort) |

## Gerrit detection & setup
| Bullet | Test |
|---|---|
| `ssh://u@host:29418/p/q` → active, `p/q`, base probed, version stored | unit/gerrit-detect.test.ts: ssh :29418 remote → gerrit… |
| No hints + 404 → none; github.com → no Gerrit | unit/gerrit-detect.test.ts: no hints and probe 404… |
| Probe fails + 29418 → "Set Gerrit URL"; override fixes it | e2e/gerrit-setup.spec.ts; unit/gerrit-detect.test.ts |
| Override "None" → tab disappears | e2e/gerrit-setup.spec.ts; e2e/gerrit-settings.spec.ts |
| Credentials: right → "Connected as", stored encrypted; wrong → 401, nothing stored | e2e/gerrit-credentials.spec.ts (both) |
| Change-Id by gitdock without hook; hook respected; amend keeps it; nothing downloaded/written | integration/gerrit-git.test.ts; e2e/gerrit-changeid.spec.ts (asserts hooks dir unchanged and no `/tools/hooks` request) |

## Gerrit review loop
| Bullet | Test |
|---|---|
| Send with topic/reviewer/WIP → `%topic=t,r=a@b.c,wip`; toast parses URL | e2e/gerrit-send.spec.ts: send for review with topic…; integration/gerrit-git.test.ts; e2e/journeys.spec.ts: gerrit daily loop… |
| N>1 commits listed with warning | e2e/gerrit-send.spec.ts: N>1 commits… |
| Amend with same Change-Id → pre-ticked "new patchset of #N"; push succeeds | e2e/gerrit-send.spec.ts: HEAD with an open change…; …pre-ticked amend waits for the fresh HEAD message…; e2e/journeys.spec.ts: gerrit daily loop… |
| No Change-Id → send blocked with fix action | e2e/gerrit-send.spec.ts: N>1…; e2e/gerrit-changeid.spec.ts |
| Reviews Outgoing/Incoming/Closed; "This project only" | e2e/gerrit-reviews.spec.ts |
| Detail: files incl. Commit Message, side-by-side, threads by `in_reply_to` | e2e/gerrit-detail.spec.ts; e2e/gerrit-comments.spec.ts: threads grouped…; unit/gerrit-util.test.ts |
| Vote pickers = `permitted_labels` (CR+V, CR only) | e2e/gerrit-comments.spec.ts: vote pickers… |
| Reply = one POST with message, labels, comments; failure keeps pending | e2e/gerrit-comments.spec.ts: reply sends one review POST…; e2e/journeys.spec.ts: gerrit daily loop… |
| Submit/Abandon/Rebase only when in actions; call endpoint, refresh | e2e/gerrit-actions.spec.ts (3 tests) |
| Checkout → `refs/changes/NN/N/P` → `change/N-psP` | e2e/gerrit-checkout.spec.ts; integration/gerrit-git.test.ts |
| Rebase onto upstream: clean / conflict | e2e/rebase.spec.ts; integration/rebase.test.ts |

## Settings / native
| Bullet | Test |
|---|---|
| Theme System follows OS change; Dark override persists | e2e/native.spec.ts: theme follows the OS by default (initial state + live restyle on a prefers-color-scheme change, emulated); e2e/settings.spec.ts (Dark persists). Real OS switch: **manual** |
| Window bounds persist; second launch focuses first | e2e/native.spec.ts: window bounds persist… |
| Every §7 shortcut triggers its action | e2e/native.spec.ts: menu accelerators… |

## MVP extras (REVIEW.md batch B)
| Behaviour | Test |
|---|---|
| Open in editor / terminal: custom executable (picked natively, non-executable refused), Changes empty state, menu Mod+Shift+A / Mod+`, System default → OS | e2e/external.spec.ts (macOS/Linux; Windows launch: **manual**); e2e/native.spec.ts (accelerators) |
| Changes right-click (native menu): discard (confirm), ignore → exact anchored `.gitignore` pattern (untracked only, symlinked `.gitignore` refused), reveal, open in editor, copy path | e2e/context-menu.spec.ts; integration/ignore.test.ts |
| Diff "Show whitespace" (· / →) persists across restart; Settings → Commit 72-column description ruler | e2e/diff-prefs.spec.ts |
| History "Amend last commit" only on an unpushed HEAD → Changes with amend ticked and message prefilled | e2e/history.spec.ts: Amend on an unpushed HEAD… |
| Gerrit change detail "Copy fetch command" → `git fetch <remote> refs/changes/NN/N/P && git checkout FETCH_HEAD` via main clipboard | e2e/gerrit-detail.spec.ts: change detail…; unit/gerrit-util.test.ts: fetchCommand… |
| Welcome "Who are you?" form only while global `user.name`/`user.email` is unset; writes `git config --global` | e2e/identity.spec.ts (both) |

## Updates
| Bullet | Test |
|---|---|
| Newer → pill; same/older → up to date | e2e/update.spec.ts; e2e/journeys.spec.ts: update… |
| Progress; finished → "Restart to update" (install mocked) | e2e/update.spec.ts; e2e/journeys.spec.ts: update… |
| Feed unreachable → error with retry | e2e/update.spec.ts: unreachable feed… |

## Packaged build
`npm run dist`, then `node scripts/smoke-packaged.mjs --refuses release/mac-arm64/gitdock.app/Contents/MacOS/gitdock` (the release build quits on `--remote-debugging-*` / `--inspect`, P2) and `npx @electron/fuses read --app release/mac-arm64/gitdock.app`.
`npm run dist:smoke` (same packaging, e2e-mode main so CDP is allowed, S13), then `node scripts/smoke-packaged.mjs release-smoke/mac-arm64/gitdock.app/Contents/MacOS/gitdock` (launches over CDP, asserts the hardened welcome screen).

## Manual checklist
Automation can't cover these; run before a release.

- [ ] **Real Gerrit 3.1.3** (`docker run -p 8080:8080 -p 29418:29418 gerritcodereview/gerrit:3.1.3`): open a clone, Connect with an HTTP password → "Connected as"; commit → Send for review with topic → change appears in the web UI with the topic; amend → Send → web UI shows Patch Set 2 on the same change; Reviews tab lists it; reply with Code-Review +1 and an inline comment → visible in the web UI; Submit (if permitted) → Merged; Checkout locally of another change.
- [ ] **Gerrit ≥ 3.13 auth token** instead of an HTTP password: Connect works; a revoked token shows the expiry hint.
- [ ] **SSH passphrase prompt**: key with a passphrase, no agent (`ssh-add -D`), `ssh://` remote → Fetch shows the passphrase modal (masked); wrong passphrase re-prompts/fails cleanly; Cancel ends the fetch with a message within 5 s. Unknown host key → yes/no confirm modal.
- [ ] **HTTPS credential helper**: with the OS helper configured (osxkeychain / manager / libsecret), push asks once, then not again.
- [ ] **Windows** (installer from `npm run dist` on Windows): install, launch, welcome renders, git found; open repo, commit, push over HTTPS with askpass prompt; paths with spaces and non-ASCII names; Ctrl shortcuts; uninstall.
- [ ] **Linux** (AppImage + deb, X11 and Wayland): launch (sandbox works without `--no-sandbox`), commit/push, askpass prompt, `.desktop` entry, file watcher on a large repo (inotify limits).
- [ ] **OS theme switching**: Settings → Theme = System; toggle the OS dark/light mode while the app is open → UI switches live without restart; Theme = Dark stays dark when the OS is light, also after restart.
- [ ] **Real update install**: build version N, publish N+1 to a test feed (`-c.publish.provider=generic`), run N → pill → Download → Restart to update → app restarts as N+1 with settings and recents kept. macOS needs a signed build (unsigned shows the download-page path instead); Windows NSIS; Linux AppImage.
- [ ] **Signed/notarized macOS build**: Gatekeeper opens the dmg app without warnings; `spctl -a -vv` accepts it; fuses still as configured.
- [ ] **First launch on a clean machine**: no global `user.name`/`user.email` → inline "Who are you?" form writes them; macOS keychain prompt on first credential save is expected once.
