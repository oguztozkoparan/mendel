# mendel — Product Plan

Cross-platform desktop git client (Electron + React + Vite + TypeScript), GitHub Desktop-style, with **provider plugins** that auto-activate from a repo's remote. First provider: **Gerrit** (any Gerrit server). Library and security choices live in `docs/TECH.md`; this doc is the *what* and the *done when*.

---

## 1. Goals / non-goals

**Goals**
- Daily git work without the terminal: see changes, stage, write a commit (summary + description), branch, sync, read history.
- Works on any local repo with the system `git` (same hooks, SSH keys, credential helpers as the terminal).
- Gerrit review loop inside the app: send for review, new patchset by amend, list my/incoming changes, read diffs and comment threads, vote, submit, abandon, check out a change, rebase.
- Provider model that GitHub/Bitbucket can plug into later without touching git core.
- Self-updating app with a reproducible release process in this repo.
- macOS, Windows, Linux.

**Non-goals (v1)**
- Bundled git or a JS git implementation. We require system `git` ≥ 2.30.
- Third-party / runtime-installed plugins. Providers are built-in modules compiled into the app.
- Built-in code editor or 3-way merge editor.
- Full Gerrit web UI parity (admin, groups, project config, dashboards, attention-set management, hashtags editing, edit-in-browser).
- GitHub/Bitbucket features (only stub detection in v1).
- Submodules, LFS management, worktrees, interactive rebase, cherry-pick UI, tags UI, blame.
- Creating new repos from scratch (`git init`) — trivial later, not needed now.

---

## 2. Scope

### MVP
| Area      | In MVP                                                                                                                                                                                                                                                                                                                                               |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repos     | Open local folder, clone (URL + target dir), recent repos list, remove from list, reveal in file manager, open in external editor / terminal                                                                                                                                                                                                         |
| Changes   | File list (staged/unstaged/untracked/conflicted), unified diff, stage/unstage file, **stage/unstage hunk**, discard file/hunk (with confirm), select-all                                                                                                                                                                                             |
| Commit    | Separate **Summary** and **Description** fields, amend toggle, author shown, runs hooks (`commit-msg` etc.)                                                                                                                                                                                                                                          |
| Branches  | List local/remote, create (from current/selected), switch, **stash-and-switch** when dirty, delete local (non-current, confirm)                                                                                                                                                                                                                      |
| Sync      | Fetch, pull (provider picks merge/rebase), push (provider may override), ahead/behind counts, "Rebase onto upstream"                                                                                                                                                                                                                                 |
| History   | Commit list for current branch, commit detail (message, author, date, files, per-file diff)                                                                                                                                                                                                                                                          |
| Conflicts | Minimal: banner when merge/rebase in progress, list conflicted files, "open in editor", "mark resolved", Continue / Abort                                                                                                                                                                                                                            |
| Auth      | Askpass bridge: git/ssh prompts (username, password, passphrase, unknown host key) shown as an in-app modal on macOS/Linux (Windows: off, git's Credential Manager / ssh-agent prompt instead); nothing stored by mendel                                                                                                                                                                                                               |
| Gerrit    | Detection, base-URL resolution + override, HTTP-password credentials in keychain, Change-Id trailer when hook missing, Send for review (topic/reviewers/WIP), amend → new patchset, Reviews list (mine/incoming/recently closed), change detail (files, side-by-side diff, threads, reply, votes, submit, abandon, server rebase), checkout change locally |
| App       | Settings page, native menus, shortcuts, theme follows OS, window state, update checker + download/restart, release pipeline                                                                                                                                                                                                                          |

### Decisions on borderline features
- **Conflict UI: minimal in MVP.** "Rebase onto latest" and pull are in MVP, so conflicts *will* happen; leaving the user stuck mid-rebase is unacceptable. A 3-way editor is large; users already have an editor. So: detect, list, open-in-editor, mark resolved, continue/abort.
- **Stash: only stash-and-switch in MVP.** `git switch` refuses on a dirty tree; offering "Stash & switch" + a "You have stashed changes on <branch> — Restore / Discard" banner covers 90% of use. Stash list (post-MVP): a Stashes tab lists all stashes (`git stash list`), shows the selected one's diff (History's commit detail on the stash commit, vs. the commit it was made on; untracked files not shown), and Apply / Pop / Drop (native confirm). Main resolves the renderer's stash sha to `stash@{n}` at action time, so a shifted list cannot hit the wrong entry.
- **Line-level staging → later.** Hunk staging is cheap (build a patch from the hunk, `git apply --cached`); line selection needs patch re-synthesis and more tests.
- **Multi-account → later.** One credential per Gerrit host. Git auth is owned by system git (SSH agent / credential helper), so mendel needs no account system for git itself.
- **Review notifications (new incoming review) → later.** MVP refreshes on focus and on an interval.

### Done after MVP
Line staging, stash list, tags, blame, history search & file history, cherry-pick/revert UI, `mendel` CLI launcher, Gerrit attention set + hashtags, Gerrit related changes, review notifications (new incoming reviews), interactive rebase of unpushed commits, Gerrit review history with advanced search, GitHub provider v1 (github.com: GitHub App sign-in, open pull requests list and detail, check out a same-repo pull request, create pull request on GitHub; §5.6).

### Later
GitHub after v1:
- **GitHub Enterprise**: another API base (`<host>/api/v3`) and an app registered per server; v1 matches github.com only, without a probe.
- **Checkout of fork pull requests**: needs a fetch from the fork (or `refs/pull/<N>/head`) and a push-back story; v1 refuses them in main.
- **Diff and file list**: local Check out + History already show the change; an in-app diff needs the files API and the diff view wired to it.
- **Comments, reviews, merge and any API write**: v1 only GETs; writes need more app permissions, confirms and error UX.
- **Markdown body and avatars**: the body is plain text; Markdown with remote images and avatars must be fetched in main (TECH.md §6.7, CSP).
- **History badges and notifications**: extra API calls per refresh against the rate limit; Gerrit's "in review #N" pattern can be reused.
- **Pull requests of an upstream remote when origin is a fork**: detection takes the first github.com remote (`origin` first); picking `upstream` needs a rule or a setting.
- **Paging past 50**: the first page only; "More on GitHub" opens the full list in the browser.

Code signing: macOS Developer ID + notarization and a Windows certificate (secrets and open checks in `docs/RELEASE.md` → Signing). Until then releases are unsigned and macOS opens the download page instead of self-installing. With it: split signing and publishing into separate CI jobs (RELEASE.md → CI hardening).

### Deferred (revisit on demand)
- **3-way merge editor**: large; users already have an editor (see "Conflict UI" above).
- **Gerrit drafts sync**: drafts are local until sent by design; syncing with server drafts adds a second source of truth and conflicts.
- **Gerrit edit commit message on server / cherry-pick to branch**: creates patch sets the local branch doesn't have; amend + push already covers it.
- **Multiple accounts per host**: rare; complicates credentials and UI.
- **Beta update channel**: no beta audience yet; stable releases go straight to GitHub Releases.
- **i18n (Turkish)**: wait until the UI settles (see ui-concept.html).
- **Bitbucket provider**: after GitHub proves the provider interface; Cloud and Data Center are separate APIs.
- **SSH setup in Gerrit settings**: key generation/upload is a security surface; a connection check / show key is the acceptable part.
- **Jump lists / dock recent items**: `mendel .` and the recents list cover it.

---

## 3. Screens and layout

```
┌──────────────────────────────────────────────────────────────────────┐
│ [Repo ▾ my-app]  [Branch ▾ master]  [⟳ Fetch / ↓ Pull 2 / ↑ Push 1]  [Provider action: Send for review] │  ← toolbar
├───────────────┬──────────────────────────────────────────────────────┤
│ Changes | History | Reviews* / Pull requests* │                      │
│ ───────────── │   main pane: diff / commit detail / change detail     │
│ file / commit │                                                      │
│ / change list │                                                      │
│               │                                                      │
│ [commit box]  │                                                      │
└───────────────┴──────────────────────────────────────────────────────┘
 banners (top of main pane): conflict in progress, stash pending, provider status (no creds, no hook)
 * tab contributed by the active provider
```

Common states: **loading** = skeleton rows (no spinners blocking the whole window); **error** = inline red banner with git's stderr (collapsed, "Show details", "Copy") and a retry button; long ops show progress in the toolbar button they came from and are cancellable where git supports it (fetch/pull/push/clone).

### 3.1 Welcome (no repo open)
- Purpose: first launch / all repos closed.
- Elements: "Open local repository…", "Clone repository…", recent repos list, git version line ("git 2.47 found at /usr/bin/git").
- Empty: no recents → only the two buttons. Error: git not found / too old → blocking card with install instructions per OS and "Recheck" button; other buttons disabled.

### 3.2 Repo selector (toolbar dropdown)
- Recent repos (filterable), current marked, "Open…", "Clone…", per-row "Remove from list", "Reveal".
- Error: path no longer exists → row greyed, "Locate…" / "Remove".

### 3.3 Branch selector (toolbar dropdown)
- Filter box, "New branch…", local branches (current first, ahead/behind badge), remote branches (collapsed), right-click: delete (local, non-current).
- Empty filter result → "Create branch '<text>'" row.
- Dirty tree on switch → dialog: "Stash & switch" / "Cancel" (and "Bring changes" when git can switch without conflict — i.e. try plain `git switch` first; only show dialog if it fails).
- Detached HEAD → shows short SHA + "Create branch here".

### 3.4 Sync button (toolbar)
- One button whose label follows state: `Fetch origin` (up to date) → `Pull ↓N` (behind) → `Push ↑N` (ahead) → `Pull ↓N ↑M` (diverged; pull first). Secondary menu: Fetch, Pull, Push, Rebase onto upstream. Last-fetched time below label.
- No upstream → `Publish branch` (push `-u`). No remote → disabled with tooltip.
- With an active provider the push label/behavior may be replaced (Gerrit: "Send for review").

### 3.5 Changes tab
- Left: file list with status letter and checkbox (staged), header checkbox for all; right-click: discard, ignore (append to `.gitignore`), reveal, open in editor, copy path.
- Main: diff of selected file. Unified view; each hunk has "Stage hunk"/"Unstage hunk" and "Discard hunk". Toggle "Show whitespace". Binary → "Binary file changed". Large (> 5k lines) → "Large diff hidden — Show anyway". New file → full content. Rename → `old → new`.
- Commit box (bottom left): Summary (single line, counter, warning > 72 chars), Description (multi-line textarea, monospace, optional 72-col ruler), "Amend last commit" checkbox (prefills message from HEAD), provider check messages (e.g. "Change-Id will be added by hook/mendel"), button `Commit to <branch>` (disabled when nothing staged unless amend).
- Empty: "No local changes" + shortcuts: Open in editor, Reveal, and (if ahead) the push/send-for-review hint.
- Conflicted files: shown at top with "Open in editor" and "Mark resolved".

### 3.6 History tab
- Left: commits of current branch (summary, author, relative date, short SHA; unpushed commits marked; Gerrit: "in review #1234" badge when the Change-Id matches an open change). Infinite scroll (page 100).
- Main: commit detail — full message, author/committer, date, parents, SHA (copy), changed files list, per-file diff (read-only).
- Context menu: Copy SHA, "Amend" (HEAD only → jumps to Changes with amend on).
- Empty: "No commits yet".

### 3.7 Reviews tab (Gerrit provider)
- Left: sections **Outgoing** (owner:self, open), **Incoming** (reviewer:self, not owner, open), **Recently closed** (owner:self, merged/abandoned, last 10). Filter toggle "This project only" (default on). Each row: subject, #number, owner avatar initial, status, label summary (CR +2/−1, V +1), updated time, WIP/unresolved-comment count.
- Sidebar segmented control **Mine | History**. Mine = the sections above. History = every change of the project (any status, newest updated first; "This project only" applies), paged 50 at a time (`n`/`S`, `_more_changes`) with infinite scroll, same rows. Search field above it like the git History search ("?" help, inline error for unknown qualifiers): plain words → `message:`, qualifiers `owner:` `reviewer:` `author:` `committer:` `status:` `project:` `branch:` `topic:` `hashtag:` `change:` `file:` `label:` `is:` `before:` `after:` `age:`, ANDed. The renderer sends operator/value pairs (`gerrit:search`); main allow-lists the operators, re-checks values and quotes/escapes each one; no raw query passthrough.
- Main: change detail (3.8).
- Empty: "No open changes" + "Send for review" hint. Error: auth missing/invalid → card "Connect to Gerrit" → settings section. Server unreachable → retry. Not configured base URL → "Set Gerrit URL".
- Refresh on tab focus, on window focus, and every N min (setting).

### 3.8 Change detail (Gerrit)
- Header: subject, #number (link "Open in browser"), status, owner, branch, topic, patchset selector (`Base` vs `PS n`, default Base ↔ current), updated.
- Labels block: each label the server returns with current votes per reviewer; "Reviewers" list.
- Actions (shown only if the server's revision `actions`/permitted labels allow): **Reply** (opens reply panel), **Submit**, **Abandon** (with optional message), **Rebase** (server-side), **Checkout locally**, **Copy fetch command**.
- Files list: path, +/−, comment count; selecting a file → **side-by-side diff** (from Gerrit's diff endpoint) with inline comment threads anchored to lines; "Commit Message" pseudo-file first.
- Threads: grouped by `in_reply_to`, show author, time, resolved/unresolved; per thread: Reply, Done, Ack. Click line number → new comment.
- Activity (below labels/related, above files), like Gerrit's tabs: **Change Log** = change messages oldest first (author, `Patch Set n:` prefix and votes subtle, PS chip, relative time with absolute in the tooltip; `autogenerated:` tags muted; "Only comments" hides those and vote-only messages; long messages clamp; last 5 with "Show all") and **Comment Threads** = all published threads across files and patch sets (file or "Commit Message", line or "File comment", PS, first comment, replies, resolved state; "Unresolved only" on when any is unresolved). Clicking a thread selects its patch set and file and scrolls to the inline thread.
- Reply panel: overall message, vote pickers built **only from `permitted_labels`** (e.g. Code-Review −2…+2, Verified −1…+1 — whatever the server says), list of pending inline comments (local until sent), "Send". All sent in one review call.
- Loading: skeleton. Error: change not found / no permission → message + back.

### 3.9 Send for review dialog (Gerrit)
- Target branch (default: upstream branch name, e.g. `master`), commits that will be pushed (list; warns "This creates/updates N changes" when N > 1), Topic, Reviewers (free text, comma-separated emails/usernames; suggestions later), "Work in progress" checkbox, "Mark ready" when the change is currently WIP. Preview of final ref (`HEAD:refs/for/master%topic=x,r=a@b.com,wip`).
- Blocking checks: missing Change-Id on any commit to push → offer "Add Change-Id" amend (flow 4.6). Nothing ahead → disabled "Nothing to send".

### 3.10 Clone dialog
- URL, parent directory (native picker, default from settings), resulting folder name (editable). Progress with phases; Cancel. Errors: auth (askpass), destination exists/not empty.

### 3.11 Settings
See section 6. Modal window/page with left sections.

### 3.12 Update UI
- Toolbar/titlebar pill when an update is available: "Update v1.4.0 available". Click → panel with release notes, "Download" → progress → "Restart to update". Also in About and Settings → General.

---

## 4. UX flows

### 4.1 First launch + open repo
1. App starts → checks `git --version`. Missing/too old → Welcome shows blocking card (3.1). Stop.
2. If `user.name`/`user.email` global config empty → small inline form on Welcome ("Who are you? Used for commits") → writes `git config --global`.
3. User clicks "Open local repository…" → native folder dialog.
4. Not a git repo (`git rev-parse --show-toplevel` fails) → error "Not a git repository" (no init in MVP). Subfolder of a repo → open the top-level.
5. Repo opens on Changes tab; added to recents; provider detection runs in background (4.3). If a provider activates, its tab appears and banners show what's missing (credentials, hook).
6. On next launch, the last repo reopens automatically.

### 4.2 Daily commit & push (generic)
1. Changes tab lists files; user ticks files or uses "Stage hunk".
2. Types Summary (required) and optional Description. Message written as `summary\n\ndescription` via `git commit -F <tmpfile>` (hooks run).
3. Cmd/Ctrl+Enter → commit. Hook failure → error banner with hook output; message is kept.
4. Toolbar shows `Push ↑1`. Click → `git push`. Behind remote → push rejected → banner "Remote has new commits. Pull first" with button Pull.
5. Success → button returns to `Fetch origin`; ahead count 0.

### 4.3 Gerrit detection
1. On repo open: read remotes (`origin` first, then upstream remote of current branch).
2. Static match → Gerrit candidate (see 5.2). Resolve HTTPS base URL (cached per host) by probing; on success store `{host, baseUrl, version}`.
3. Activate Gerrit provider: Reviews tab, Send for review replaces Push, pull default = rebase.
4. Probe fails but static match is strong (port 29418) → provider still activates; Reviews tab shows "Set Gerrit URL" card (git flows that don't need REST — send for review, checkout by number — keep working).
5. User can override per repo in Repo settings: Provider = Auto / Gerrit / None, Base URL.

### 4.4 Gerrit: send for review → amend → new patchset
1. User commits on local `master` (tracking `origin/master`). Commit box shows provider note "Change-Id: will be added by commit-msg hook" if hook present; otherwise warning (4.6).
2. Toolbar shows **Send for review ↑1**. Click → dialog 3.9 → Send.
3. App runs `git push <remote> HEAD:refs/for/<branch>%<opts>`; parses remote output (`remote:   https://…/c/project/+/1234 subject [NEW]`) → success toast with link "Open change #1234" (opens in Reviews tab).
4. Reviewer asks for changes. User edits files, stages, ticks **Amend last commit** (Gerrit provider pre-ticks it and shows "Will upload a new patchset of #1234" when HEAD's Change-Id matches an open change and HEAD isn't in the upstream branch).
5. Commit (amend keeps the Change-Id) → Send for review again → output shows existing change → toast "Patchset 2 uploaded to #1234".
6. Edge: push rejected "no new changes" → info toast "Nothing changed since last patchset". Push of N>1 commits → dialog listed them before sending.
7. After the change is merged: Pull (rebase) drops the now-upstream commit; ahead count returns to 0.

### 4.5 Gerrit: reviews list → change detail → act
1. Reviews tab loads Outgoing / Incoming / Recently closed.
2. Click a change → detail (3.8): current patchset files, Commit Message first.
3. Select file → side-by-side diff with threads. User clicks a line → types comment → saved as pending (local, survives app restart, per change).
4. On an existing thread → Reply / Done / Ack → pending.
5. Click **Reply** → panel with overall message, label pickers from `permitted_labels`, pending comments list → Send → one `POST …/review`. Success → detail reloads, pending cleared. Failure → pending kept, error shown.
6. **Submit** (only if the server lists the action) → confirm → submit; on success status = Merged and a "Pull to update local branch" hint.
7. **Abandon** → dialog with optional message → abandon. **Rebase** (server) → rebase; conflict response → message "Rebase locally" with button (4.8).

### 4.6 Change-Id missing → app adds it (no server code is downloaded)
1. Triggered when: Gerrit active and no `commit-msg` hook in the hooks dir (respect `core.hooksPath`), or a commit to be sent lacks `Change-Id: I[0-9a-f]{40}`.
2. If a `commit-msg` hook exists, mendel does nothing extra (the hook adds Change-Id as in the terminal).
3. If no hook: the Gerrit provider's commit-message transform appends `Change-Id: I<sha1>` itself before commit (same algorithm as Gerrit's hook: sha1 over tree, parent, author, committer and message; added via `git interpret-trailers --if-exists doNothing`). Commit box note: "Change-Id will be added by mendel". Rationale (TECH.md §6): downloading `<base>/tools/hooks/commit-msg` means executing code served by the network.
4. If unpushed commits lack Change-Id: offer "Add Change-Id to last commit" → amend with the computed trailer. More than one such commit → explain and point to terminal (interactive rebase is a non-goal).

### 4.7 Checkout a change locally
1. In change detail → **Checkout locally** (current or selected patchset).
2. `git fetch <remote> refs/changes/<NN>/<number>/<ps>` where NN = last two digits of number, zero-padded.
3. Dirty tree → same stash-and-switch dialog as branches.
4. `git switch -c change/<number>-ps<ps> FETCH_HEAD` (if branch exists for an older patchset → `git switch -C` after confirm).
5. Toast "Checked out #1234 PS3 on change/1234-ps3". Amend + Send for review from here uploads a new patchset to the same change (target branch = the change's branch).

### 4.8 Rebase onto latest
1. Sync menu → **Rebase onto upstream** (also Gerrit detail "Rebase locally").
2. `git fetch` → `git rebase <upstream>` (dirty tree → stash-and-switch style dialog "Stash & rebase").
3. Clean → toast; Gerrit shows "Send for review" to upload the rebased patchset.
4. Conflicts → conflict banner: list files, Open in editor, Mark resolved (`git add`), **Continue** (`git rebase --continue` with `GIT_EDITOR=true`), **Abort**. Same banner for merge conflicts from pull.

### 4.9 Gerrit credentials
1. Reviews tab or Settings → Gerrit hosts → "Connect".
2. Dialog shows host + base URL (editable), username (prefilled from SSH remote user), HTTP password or access token field (Gerrit 3.13+ deprecates HTTP passwords for expiring tokens; both are Basic auth; on 401 after it worked before, show "credential expired" and reopen this dialog), link "Get your HTTP password" → `<baseUrl>/#/settings/http-password` (opens browser).
3. "Test & save" → `GET <baseUrl>/a/accounts/self` with Basic auth. 200 → show "Connected as <name> (<email>)", store password encrypted (OS keychain via `safeStorage`). 401 → "Wrong username or HTTP password" (not saved). Network/TLS error → show and keep dialog open.
4. Settings → Remove → deletes stored secret.

### 4.10 Update available → download → restart
1. On startup (after 10 s) and every 6 h (setting on by default), check the release feed for a newer semver on the stable channel.
2. Newer → pill "Update vX.Y.Z". Click → notes + **Download** → progress → **Restart to update**. If a git operation is running, restart waits/asks.
3. Platform can't self-install (unsigned macOS build, unsupported Linux package) → "Download" saves the installer to Downloads and reveals it instead.
4. Manual: menu "Check for Updates…" → "You're up to date (vX.Y.Z)" / error with retry.

---

## 5. Provider plugin model

### 5.1 Principles
- Built-in modules: main-side logic in `src/main/providers/<id>/` (detection, REST, git commands, secrets), renderer-side views in `src/renderer/providers/<id>/` registered under the same id. Renderer talks to the provider only through typed IPC, like everything else.
- At most one active provider per repo. Git core never imports a provider; providers call git core.
- Providers are independent: a provider never imports another provider's code (GitHub never imports from a Gerrit folder or file, and the reverse). What two providers need lives in a neutral module (`src/main/providers/credentials.ts`, `http.ts`, `remotes.ts`, `src/main/git/branch.ts` `checkoutRef`, `src/renderer/src/providers/Provider.module.css`). Settings → Git providers has a section per provider (plus a provider-neutral "This repository" section).
- A provider adds; it never removes git core features (Gerrit can hide the plain Push from the main button but keeps it in the menu behind a confirm "Push directly to refs/heads/<branch>?").

### 5.2 Detection
Input: parsed remotes `{name, url, protocol: ssh|https|file, host, port, user, path}` (supports `ssh://`, scp-style `user@host:path`, `https://`).

Order per remote (first hit wins; result cached per host in app data; per-repo user override beats everything):
1. **Static hints** (no network):
   - Gerrit: SSH port `29418`, or HTTPS path starting with `/r/`, `/a/`, `/gerrit/` → candidate.
   - GitHub: host `github.com` or `ssh.github.com` and a path of exactly `owner/repo` (each part `[A-Za-z0-9_.-]+`, not `.`/`..`) → active without a probe, `baseUrl = https://api.github.com`, project `owner/repo`. Other hosts (GitHub Enterprise) are not matched. Registered after Gerrit; Gerrit's probe skips `github.com`, `bitbucket.org`, `gitlab.com`.
   - Bitbucket: no detection yet (`'bitbucket'` is only a reserved id).
2. **Probe** (HTTPS only, 3 s timeout, only for unknown hosts or Gerrit candidates): for candidate bases `https://<host>`, `https://<host>/r`, `https://<host>/gerrit` (or the HTTPS remote's prefix before the project path), `GET <base>/config/server/version` → HTTP 200 and body starts with `)]}'` → Gerrit, record version from the JSON string.
3. **Project name**: SSH path without leading `/` and trailing `.git` (`team/project`); HTTPS path minus base prefix and `/a/`.
4. Strong static hint but probe failed → activate with `baseUrl = null` (REST features ask the user to set it).

The per-host cache (`{host, baseUrl, version}`) is Gerrit-only. The repo override is Auto / Gerrit / None: None also turns GitHub off; there is no GitHub override (Auto detects it).

### 5.3 What a provider contributes (minimal, Gerrit-driven)
| Contribution | Gerrit | GitHub (v1) |
|---|---|---|
| Toolbar primary action when ahead | "Send for review" | none: plain "Push"; "Create pull request" sits in the Pull requests tab |
| Push override (dialog + refspec) | `HEAD:refs/for/<b>%topic,r,wip,ready` | none |
| Pull default strategy | rebase | the Git setting (merge / rebase) |
| Repo tab / panel | Reviews | Pull requests |
| Commit-message checks / hints | Change-Id present or hook installed; amend suggestion | none |
| Commit-message template | none (hook handles it) | none |
| Status banners | no creds, no hook, no base URL | none; sign-in and "install the app" cards inside the Pull requests tab |
| History badges | "in review #N" by Change-Id | none (later) |
| Settings section | hosts: base URL, user, HTTP password | account (per host): Sign in / Sign out, "Install the GitHub App…" |

### 5.4 Interface sketch
What exists today (`src/main/providers/index.ts`) is only `interface Provider { id: ProviderId; detect(remotes, probe): Promise<Detection | null> }` plus the registry (`registerProvider`, `detectProvider`: first registered provider that detects wins). Everything else a provider does goes through its own typed IPC channels (`gerrit:*`, `github:*`), and `RepoView` / `Settings` render each provider's tab and section directly by `detection.provider`; there is no `ProviderSession`, component registry or generic `invoke`. The sketch below is the target shape, not code:
```ts
type ProviderId = 'gerrit' | 'github' | 'bitbucket';

interface Remote { name: string; url: string; protocol: 'ssh' | 'https' | 'file'; host: string; port?: number; user?: string; path: string }

interface Detection { provider: ProviderId; remote: string; host: string; baseUrl: string | null; project: string; serverVersion?: string }

interface Provider {                                  // main process
  id: ProviderId;
  detect(remotes: Remote[], probe: (url: string) => Promise<HttpResult>): Promise<Detection | null>;
  activate(repo: RepoContext, d: Detection): ProviderSession;
}

interface ProviderSession {
  status(): Promise<StatusItem[]>;                    // banners: {id, level, text, action?}
  primaryAction?(s: RepoState): ActionSpec | null;    // replaces toolbar Push label/handler when ahead
  push?: {
    dialog: 'gerrit-send';                            // renderer component id
    run(opts: unknown, onProgress: ProgressFn): Promise<PushResult>;
  };
  pullStrategy?: 'rebase' | 'merge';
  checkCommit?(msg: string, s: RepoState): Promise<CommitHint[]>;      // {level, text, fix?: ActionSpec}
  annotateCommits?(shas: string[]): Promise<Record<string, Badge>>;    // History badges
  tabs: { id: string; title: string; component: string }[];           // e.g. {id:'reviews', component:'gerrit-reviews'}
  invoke(method: string, args: unknown): Promise<unknown>;            // provider-specific IPC (typed per provider on both sides)
  dispose(): void;
}

interface ProviderSettings { id: ProviderId; component: string }     // settings section component id
```
Renderer keeps a registry `{componentId → React component}`; unknown ids render nothing. GitHub plugs in by adding a `Provider` + its components; no git-core changes.

### 5.5 Gerrit REST usage (for implementers)
All via `<baseUrl>/a/...` with HTTP Basic (username + HTTP password); strip the `)]}'` prefix before JSON parse. Gate features by server version where noted; target Gerrit ≥ 2.15. Older target to keep working: **3.1.3** — no attention set (3.3+), no `submit_requirements` (3.5+), no access tokens (3.13+); never require these.
- Version: `GET /config/server/version` (no auth). Me: `GET /a/accounts/self`.
- Lists: `GET /a/changes/?q=status:open+owner:self[+project:<p>]&q=status:open+reviewer:self+-owner:self[...]&q=owner:self+-is:open&n=10&o=LABELS&o=DETAILED_ACCOUNTS&o=CURRENT_REVISION`.
- Detail: `GET /a/changes/<id>/detail?o=CURRENT_REVISION&o=ALL_REVISIONS&o=DETAILED_LABELS&o=CURRENT_ACTIONS&o=SUBMITTABLE&o=MESSAGES` (use `permitted_labels` for vote pickers, actions for buttons).
- Files/diff: `GET /a/changes/<id>/revisions/<rev>/files[?base=<ps>]`, `.../files/<path>/diff[?base=<ps>]` (`content[]` of `ab`/`a`/`b` blocks → side-by-side).
- Comments: `GET /a/changes/<id>/comments` (threads via `in_reply_to`; `unresolved` on 2.15+).
- Reply/vote: `POST /a/changes/<id>/revisions/<rev>/review` `{message, labels, comments: {path: [{line|range, message, in_reply_to, unresolved}]}}`.
- `POST /a/changes/<id>/submit`, `/abandon`, `/rebase`.
- Push options use the `%` refspec suffix (works on old servers): `%topic=<t>`, `r=<reviewer>` (repeat), `wip`, `ready`.

### 5.6 GitHub (for implementers)
github.com only; main in `src/main/providers/github/` (`detect.ts`, `client.ts`) and `src/main/ipc/github.ts`, shared texts/schemas in `src/shared/github.ts`, renderer in `src/renderer/src/providers/github/`.
- **Detection**: §5.2; `{provider: 'github', remote, host, baseUrl: 'https://api.github.com', project: 'owner/repo'}`.
- **Sign-in**: GitHub App **"mendel-desktop"** with the OAuth device flow. Public client id in `client.ts`, no client secret anywhere. `POST https://github.com/login/device/code` → the dialog shows the user code (Copy) and "Open GitHub" (opens `https://github.com/login/device`, a constant in main, never the response's `verification_uri`); main polls `POST /login/oauth/access_token` at the given interval (`slow_down` raises it; expired / denied codes show their message; Cancel aborts). The device code never reaches the renderer. Then `GET /user` gives the login; the token is stored with it.
- **Tokens**: an 8 h access token plus a single-use refresh token (6 months). Stored via `providers/credentials.ts` keyed by the API host (`api.github.com`), so sign-in is per host, not per repo. Each API call refreshes first when the access token expires within 60 s, and on one 401 refreshes and retries once; refreshes are serialized (the refresh token is single-use). GitHub refusing the refresh, an expired refresh token or a second 401 removes the credential ("Not signed in to GitHub, or the sign-in has expired"); an unreachable GitHub or a 5xx keeps it. Sign out is local only (revoking needs the client secret).
- **App installation**: a user token of a GitHub App only reaches repositories where the app is installed (public repos read fine). A 403/404 on the repo's pull requests shows "The GitHub App cannot see this repository" with "Install the GitHub App…" → `https://github.com/apps/mendel-desktop/installations/new` (also in Settings).
- **Endpoints**: `GET /user`; `GET /repos/<owner>/<repo>/pulls?state=open&per_page=50` (first page; `Link: rel="next"` → "More on GitHub"); `GET /repos/<owner>/<repo>/pulls/<N>` (checkout). Headers `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`. Rate limits (`x-ratelimit-*`, `retry-after`) show "Rate limited until HH:MM" / "retry in N s". No writes.
- **Pull requests tab** (`PullRequests.tsx`, Mod+3): sign-in card when signed out; else project header with refresh, "Create pull request", list of open pull requests (title, Draft, #N, author, updated), refreshed on the Reviews interval; detail = title, meta, `head → base`, plain-text body (no Markdown, HTML or images), **Open on GitHub**, **Check out**.
- **Check out**: main reads the pull request again from the API (never the renderer's head), rejects forks ("Fork pull requests cannot be checked out yet"; the button is disabled with that reason), validates the head branch name with `check-ref-format`, then `checkoutRef` fetches `refs/heads/<head>` from the GitHub remote onto local `pr/<N>` tracking `<remote>/<head>`; asks before resetting an existing `pr/<N>` or stashing a dirty tree.
- **Create pull request**: shown when the current branch's upstream is on the GitHub remote; main re-checks that and opens `https://github.com/<owner>/<repo>/compare/<upstream branch>?expand=1` (GitHub picks the base). Every browser url is built in main from detection and constants, each path part encoded, and dropped unless its origin is `https://github.com`.

---

## 6. Settings

| Section | Contents |
|---|---|
| General | Theme: System / Light / Dark · Default clone folder · External editor (auto-detected list + custom command) · Terminal (auto-detected + custom) · Reopen last repo on start · Confirm before discard (on) |
| Git | Detected git path + version (read-only) · Global `user.name` / `user.email` (edit) · Auto-fetch interval (off / 5 / 15 / 30 min, default 15) · Default pull strategy for repos without provider (merge / rebase) |
| Commit | Summary soft limit (default 72) · Show 72-col ruler in description · Spellcheck on/off |
| Providers → This repository | Detected provider of the open repo · "Repository provider…" (override, below) |
| Providers → Gerrit | Hosts list: host, base URL (editable), username, connection status, "Test", "Remove credentials" · Reviews refresh interval (default 5 min) · "Only this project" default |
| Providers → GitHub | Account (per host): "Signed in as <login>" / Sign in… (device flow) / Sign out · "Install the GitHub App…" · note that private repos need the app installed |
| Repository (per repo, opened from repo menu) | Provider override: Auto / Gerrit / None · Gerrit base URL override · Remote used for provider · Gerrit hook status + Install |
| Updates | Check automatically (on) · Last checked time · "Check for updates" (status and Retry shown beside it) · Current version |
| Advanced | Open logs folder · Log level · Reset app state |

Secrets never appear in plain text once saved (shown as "••• saved").

---

## 7. Keyboard shortcuts & native OS integration

`Mod` = Cmd on macOS, Ctrl elsewhere. All shown in native menus.

| Action | Shortcut |
|---|---|
| Changes / History / provider tab | Mod+1 / Mod+2 / Mod+3 |
| Repo selector | Mod+T |
| Branch selector | Mod+B |
| New branch | Mod+Shift+N |
| Open local repo | Mod+O |
| Clone | Mod+Shift+O |
| Commit (focus in commit box) | Mod+Enter |
| Fetch | Mod+Shift+F |
| Pull | Mod+Shift+L |
| Push / Send for review | Mod+P |
| Refresh status | Mod+R (also auto on window focus + file watcher) |
| Stage/unstage selected file | Space |
| Discard selected file | Mod+Backspace (confirm) |
| Open in editor / Reveal in file manager / Open terminal | Mod+Shift+A / Mod+Shift+R / Mod+` |
| Settings | Mod+, |
| Close dialog / panel | Esc |

Native expectations:
- **Menus**: platform-native menu bar (macOS app menu with About, Check for Updates, Settings, Hide, Quit; File, Edit, View, Repository, Branch, Window, Help). Items enable/disable with state.
- **Dialogs**: native folder picker; native message boxes for destructive confirms (discard, delete branch, abandon, submit).
- **Notifications**: OS notification only when the window is unfocused and a long op finishes (clone, push/send for review, pull) or an update is ready.
- **Theme**: follow OS light/dark live (`System` default); user override in settings.
- **Window**: restore size/position/maximized per display; single instance (second launch focuses existing window and opens its path argument, `mendel <dir>`); minimum size 720×600.
- **Other**: drag a folder onto the window to open it; external links open in default browser; correct app icon per OS; macOS universal behavior (window close ≠ quit).

---

## 8. Acceptance criteria (MVP)

Test setup: e2e fixtures create temp repos + a local bare remote; a **mock Gerrit HTTP server** serves recorded JSON (with `)]}'` prefix) and a bare repo accepts `refs/for/*` pushes (refs with `%` options are valid ref names, so assertions read the pushed ref). Askpass tests use a fake `GIT_ASKPASS` scenario. Each bullet = at least one test.

**App shell / security**
- Renderer has no `require`/`process`; `window.api` exposes only the typed IPC surface.
- Git missing (PATH without git) → Welcome shows blocking card; with git ≥ 2.30 shows version line.

**Repos**
- Open a repo subfolder → top-level opens; repo appears in recents; relaunch reopens it.
- Open non-repo folder → "Not a git repository", recents unchanged.
- Clone from bare fixture → repo opens on Changes; cancel mid-clone leaves no partial folder; non-empty target → error.
- Recent entry with deleted path → greyed with Locate/Remove.

**Changes & diff**
- Modify, add, delete, rename a file → list shows M/A/D/R within 2 s (watcher) or on Mod+R.
- Selecting a file shows its diff; binary file shows "Binary file changed".
- Stage file / unstage file → `git diff --cached --name-only` matches.
- Stage one hunk of a two-hunk file → only that hunk in index; unstage hunk reverts.
- Discard file (confirm) → file restored; discard hunk → only that hunk reverted; cancel confirm → no change.

**Commit**
- Summary + description → `git log -1 --format=%B` equals `summary\n\ndescription\n`.
- Commit button disabled with empty summary or nothing staged.
- Amend → HEAD replaced, message prefilled from previous HEAD, commit count unchanged.
- Failing `commit-msg` hook → error shows hook stderr; message text retained.

**Branches**
- Create branch from current → switched to it. Switch with clean tree works.
- Switch with conflicting dirty tree → dialog; "Stash & switch" switches and shows restore banner; Restore on return brings changes back.
- Delete non-current local branch (confirm) → gone; current branch has no delete option.

**Sync**
- Ahead 1 → button `Push ↑1`; push → remote has commit, ahead 0.
- Remote ahead → after fetch `Pull ↓N`; pull brings commits.
- Diverged → push rejected → banner with Pull action.
- No upstream → `Publish branch` sets upstream.
- Auth prompt via askpass shows modal; Cancel aborts op with message, no hang (op ends < 5 s after cancel).

**History**
- Lists commits newest first with summary/author/date; selecting shows message, file list, per-file diff.
- 500-commit repo scrolls and pages without UI freeze (first page < 1 s).

**Conflicts**
- Pull/rebase producing a conflict → banner + conflicted files; Mark resolved + Continue completes; Abort restores pre-op HEAD.

**Gerrit detection & setup**
- Remote `ssh://u@host:29418/p/q` → Gerrit active, project `p/q`; mock base URL probed and version stored.
- Remote with no hints and probe 404 → no provider; github.com remote → no Gerrit (stub id only).
- Probe failure + port 29418 → provider active, Reviews shows "Set Gerrit URL"; saving override fixes it.
- Repo override "None" disables provider; tab disappears.
- Credentials: correct password → "Connected as …", secret stored encrypted (not in plain-text settings file); wrong → 401 message, nothing stored.
- No hook → commit gets `Change-Id: I…` added by mendel; existing hook → message left to the hook; amend keeps the same Change-Id; nothing is downloaded or written to the hooks dir.

**Gerrit review loop**
- Send for review with topic `t`, reviewer `a@b.c`, WIP → pushed ref is `refs/for/master%topic=t,r=a@b.c,wip`; success toast parses change URL from remote output.
- N>1 commits ahead → dialog lists N commits and warns.
- Amend with same Change-Id → amend pre-ticked with "new patchset of #N" text; push succeeds.
- Commit without Change-Id → Send for review blocked with fix action.
- Reviews lists Outgoing/Incoming/Closed from mock; "This project only" adds `project:` to queries.
- Change detail shows files incl. Commit Message, side-by-side diff, threads grouped by `in_reply_to`.
- Vote pickers show exactly the labels/values in `permitted_labels` (mock with Code-Review + Verified, and a variant with Code-Review only).
- Reply sends one review POST containing message, labels and pending inline comments; failure keeps pending comments.
- Submit/Abandon/Rebase buttons shown only when present in actions; each calls its endpoint and refreshes.
- Checkout locally → fetches `refs/changes/NN/N/P`, creates `change/N-psP` on that commit.
- Rebase onto upstream: clean case rebases; conflict case shows banner.

**Settings / native**
- Theme System follows OS change; Dark override persists after restart.
- Window size/position persist across restart; second launch focuses first instance.
- Every shortcut in section 7 triggers its action (menu accelerator test).

**Updates**
- Feed with newer version → pill appears; with same/older → "up to date".
- Download progress shown; finished → "Restart to update" (install step mocked in e2e).
- Feed unreachable → error with retry, app otherwise unaffected.

---

## 9. Release process

- Version source: `package.json` `version`, semver. Tag `vX.Y.Z` triggers CI.
- CI matrix builds macOS (arm64 + x64, dmg + zip), Windows (x64 installer), Linux (AppImage + deb), generates update metadata, uploads to a **draft** release; a human publishes it (publishing = what the update checker sees).
- Release notes generated from `feat(...)`/`bug(...)` commits since the previous tag, grouped Features / Fixes.
- Local command `npm run release`: verifies clean tree on default branch + passing typecheck/tests, bumps version (bump picked from the commits since the last tag: `feat` → minor, only `bug` → patch; `-- <major|minor|patch>` overrides), commits `feat(release): vX.Y.Z` (only `feat`/`bug` prefixes are allowed by the commit hook), tags. Pushing the tag is manual (CLAUDE.md: no push unless asked).
- Signing: macOS Developer ID + notarization and Windows code signing via CI secrets when available. Without them builds still release, but macOS auto-install is disabled (flow 4.10 step 3).

---

## 10. Build order (one commit each)

1. `feat(app): scaffold electron react vite ts app with secure window and typed ipc`
2. `feat(test): unit and e2e harness with fixture repos and bare remote`
3. `feat(git): git runner with arg arrays, version check and error mapping`
4. `feat(auth): askpass bridge for git and ssh prompts`
5. `feat(repo): open local repo, recent repos and repo selector`
6. `feat(repo): clone dialog with progress and cancel`
7. `feat(changes): status list with watcher and file diff view`
8. `feat(changes): stage and unstage files and hunks`
9. `feat(changes): discard file and hunk changes`
10. `feat(commit): commit box with summary, description and amend`
11. `feat(branch): branch selector with create, switch, delete and stash-and-switch`
12. `feat(sync): fetch, pull, push, publish with ahead and behind`
13. `feat(history): commit log and commit detail`
14. `feat(conflicts): conflict banner with mark resolved, continue and abort`
15. `feat(sync): rebase onto upstream`
16. `feat(settings): settings page and persisted preferences`
17. `feat(app): native menus, shortcuts, theme and window state`
18. `feat(providers): provider registry, remote parsing and detection`
19. `feat(gerrit): detection, base url probe and repo override`
20. `feat(gerrit): http password credentials in os keychain`
21. `feat(gerrit): change-id trailer when commit-msg hook is missing`
22. `feat(gerrit): send for review with topic, reviewers and wip`
23. `feat(gerrit): amend as new patchset hints and history badges`
24. `feat(gerrit): reviews list`
25. `feat(gerrit): change detail with files and side-by-side diff`
26. `feat(gerrit): comment threads, reply and votes`
27. `feat(gerrit): submit, abandon and server rebase`
28. `feat(gerrit): checkout change locally`
29. `feat(update): update checker with download and restart`
30. `feat(release): release script, ci build matrix and notes generation`

Items 1–17 give a usable generic client; 18–28 can start after 18 in parallel with 13–17; 29–30 need only 1 and 16.

---

## 11. Worktrees (first version)

Goal: work on several branches at once without stashing. Each worktree is opened as its own repo in mendel; git does the work (`git worktree …`), mendel lists, creates, opens and removes them.

**In scope**
- **List**: `git worktree list --porcelain -z` (git ≥ 2.36; with older git the list fails and the Worktree button stays hidden) → path, HEAD, branch (or detached), main, locked (+ reason), prunable. Bare main entries are skipped. Shown in its own toolbar button next to the branch button (caption "Worktree", value "Main" or the current worktree's folder; shown whenever a repo is open, so with only the main worktree the popover holds just that row and "New worktree…"); current one ticked, main tagged, locked shows its reason, prunable rows greyed with "Prune", others with "Open" (and "Remove", not for main).
- **Recents**: a linked worktree is its own recents entry (own id, so own provider override), labelled `<main repo name> · <branch>` with a worktree icon and nested under its main repo's entry when that is in the list. Main reads the worktree's `.git` file (`gitdir: <main>/.git/worktrees/<name>`, relative paths allowed) and `<gitdir>/HEAD` with plain fs reads, no git call per list. Opening works as for any repo: `rev-parse --show-toplevel` already handles `.git` files.
- **Create**: "New worktree…" at the bottom of the Worktree menu (new branch from the current branch) and, in the branch menu, a per-row "New worktree for <branch>" (local branches not checked out anywhere, and remote branches) with a choice "Check out <branch>" / "New branch from <branch>". Dialog: branch name (new), parent folder (default: the main worktree's parent dir; "Choose…" = native folder dialog in main, remembered per repo for the session), folder name (default `<repo>-<branch>` with `/` → `-`), "Open after creating". Main validates the branch name (`validateBranchName`), the base/existing branch against the branch list, and the folder name like the clone dialog (single path segment under the parent; resolveUnder). git refuses a non-empty target. Runs `git worktree add -b <new> --end-of-options <path> <base>` or `git worktree add --end-of-options <path> <branch>`; a remote branch `origin/x` becomes local `x` tracking it (`-b x --track`), as in switch.
- **Open**: `worktree:open {repo, path}` only accepts a path that `git worktree list` of that repo reports; then the normal open (dubious-ownership trust prompt, recents).
- **Branch checked out elsewhere**: `branch:list` reads `%(worktreepath)` (git ≥ 2.23), so local branches checked out in another worktree are marked (worktree icon, no delete button). Picking one (or its remote) does not call `git switch`; a notice says "<branch> is checked out in <path>" with "Open that worktree". If git still refuses (race), main turns "already checked out at / used by worktree at '<path>'" into the same text.
- **Remove**: per-row "Remove worktree" (not the main one, not the one open in this window, not prunable ones). Path must be one `git worktree list` reports. Native confirm ("The folder is deleted; branch <b> is kept"); if git refuses because the worktree has changes, a second confirm "Remove anyway" runs `--force`. Locked worktrees: git's error is shown (no double force). Afterwards its recents entry is dropped.
- **Prune**: `git worktree prune` from a prunable row.
- **Per-worktree behaviour**: provider detection reads the shared remotes, Gerrit hook lookup uses `--git-path` (shared hooks), credentials are per host, the sync lock is app-wide: no change needed. The file watcher additionally watches a linked worktree's own git dir (`rev-parse --absolute-git-dir`, non-recursive: index, HEAD) since it lives outside the work tree; the main repo's watcher ignores `.git/worktrees/`.

**Out of scope (v1)**: lock/unlock, move, repair, `--detach` worktrees from a commit, per-worktree config, opening a bare repo's worktrees from the bare repo, a separate worktree list in the repo menu (recents nesting covers it).

**Security**: renderer sends only `repo` ids, branch names (validated in main), a single folder-name segment and worktree paths that main re-checks against `git worktree list`; the parent folder comes only from the native dialog or the main worktree; argv arrays with `--end-of-options`; removal only through `git worktree remove`, never `fs.rm`.

**Done when**: integration tests (list/add/remove/prune, branch-elsewhere, open a linked worktree, watcher on a linked worktree) and `test/e2e/worktree.spec.ts` (create from new branch + open, branch-elsewhere notice + open, remove with dirty confirm) pass.
