# Review & security findings (phase 4) — fix plan

Sources: read-only code review (R#) and security review (S#), 2026-11-04. Spot-verified by the orchestrator: R1 (runner decodes each chunk separately), R4 (no negative provider cache), R10 (Send for review requires upstream), S4 (no `%` check on review target).

## Batch A — fix now (`bug(<scope>): ...`, one commit per finding or tight group, each with a regression test)

### Security
- **S1** Untrusted repo config runs code on open. Background reads (status, diff, log, ls-files, for-each-ref, rev-parse…) pass `-c core.fsmonitor=false`. Run `interpret-trailers` with a cwd outside any repo (temp dir) so `trailer.*.cmd` from the repo's config is never read. Filters/hooks/sshCommand stay (terminal parity, LFS) — document in TECH §6.3.
- **S16** `DubiousOwnership`: show an explanation + "Trust this folder" (native confirm in main → `git config --global --add safe.directory <exact path>`; never `*`).
- **S4** Reject `%` (and `,`/`=`) in the review target branch in `reviewRef`.
- **S5 + R15** Askpass: accept prompts only while a gitdock git op is running (per-op token, revoked when the child exits); dismiss the modal and settle `null` when the askpass socket closes; show which repo/op asked.
- **S6** Realpath re-check after `resolveUnder` for paths read outside git's own path handling (untracked `diff --no-index`).
- **S7 + R8** `timeoutMs` for background reads and auto-fetch (e.g. 120 s for network, 30 s for local reads); a manual op aborts a running auto-fetch; checkout-change honours the abort signal; abort all git children on `will-quit`.
- **S8 + R4** Probe only the remote(s) actually used (origin / upstream of current branch); in-memory negative cache per host, cleared when remotes or override change.
- **S9** Write userData JSON files with mode `0o600`.
- **S10** Escape `"` and `\` in Gerrit `project:"…"` queries.
- **S11** `redact`: handle `@` inside the password part (match up to the last `@` before host); redact nested strings in log objects.
- **S13** Gate all e2e/dev seams (`__gitdockTest`, `GITDOCK_E2E_*`, `use-mock-keychain`, dev origin) behind a build-time `define`, not `app.isPackaged`.
- **S2 + R24 + S14 + S15** Release/CI: `persist-credentials: false`; `.npmrc` `ignore-scripts=true` + explicit electron binary install step; create the draft release once before the matrix (`gh release create --draft --verify-tag`); `npx @electron/fuses read` check on the built app; `npm audit --omit=dev --audit-level=high` step; `.github/dependabot.yml` (npm + actions, weekly). Splitting sign/publish into separate jobs: defer, note in RELEASE.md.
- **R26** `release.mjs`: fetch and require `HEAD == origin/main`.

### Correctness / robustness
- **R1** Decode stdout/stderr with `setEncoding('utf8')` (split multibyte chars). Regression test with >64 KB non-ASCII output.
- **R2** macOS/Linux packaged: merge login-shell PATH (`$SHELL -ilc 'printf %s "$PATH"'`, timeout) into the runner env at startup.
- **R3** `repo:changed` invalidates only local git keys (status, diff, commitInfo, sync, branches, conflict) with throttle + max-wait; provider/Gerrit/History queries refresh on interval/focus/explicit ops only.
- **R5** History: cursor paging (`<lastSha>^`-style or `--skip` capped with `maxPages`); don't refetch all pages on invalidate.
- **R6 + R7 + R22(diff gate)** One shared large-diff gate checked on the raw string *before* `parseDiff`; used by Changes, History, Gerrit; History file list virtualized.
- **R9** Multi-patch-set reply: post older-PS comment-only calls first, current PS (message+labels) last; drop drafts per successful call.
- **R10** Gerrit repo: Send for review offered whenever there are unpushed commits, upstream or not; plain Push/Publish in a Gerrit repo asks for confirmation ("Push directly to refs/heads/<b>?", PLAN §5.1).
- **R11 + R14** After `rebase --autostash` / `pull --rebase --autostash` success, check `ls-files --unmerged` → `'conflict'` + "your changes are kept in stash" note; Gerrit pull uses `--autostash` with the same confirm as `sync:rebase`.
- **R12** Hint lookups (`openByChangeId`, badges) use a ~3 s timeout and don't block returning the commit list.
- **R13** Discard on unborn branch: `git rm --cached -q` + `clean` when HEAD doesn't resolve.
- **R16** Reviews list uses `o=LABELS`.
- **R17** "Stage all" uses `git add -A` (no path list) — avoids the 100k cap.
- **R19** Update restart refuses/asks while a git op is running.
- **R21/R22/R23** Pass already-read state instead of re-running `listBranches`/`syncState`; dedupe stash-push args and stash-list parsing; `Collection dependencies` keyed on badge data not a fresh arrow.
- **watch.ts Linux** recursive watch: skip `node_modules` and ignored dirs (`git check-ignore` on top-level dirs once), fall back gracefully on ENOSPC with a visible "auto-refresh off" notice.

### From phase 3
- **P1** Move renderer-only libs (react, react-dom, react-aria-components, lucide-react, react-diff-view, react-markdown, @tanstack/*) to devDependencies so they are not shipped twice in `app.asar` (~80 MB); verify packaged smoke still passes (`scripts/smoke-packaged.mjs`).
- **P2** Packaged build accepts `--remote-debugging-port` / `--inspect*`: quit at startup when these switches are present unless the build-time e2e define (S13) is set; keep `scripts/smoke-packaged.mjs` working (build it with the define, or drive it differently).

## Batch B — missing MVP features (`feat(<scope>): ...`, after batch A)
- R18: open in external editor / terminal (+ Settings→General editor/terminal choice, PLAN §6), Changes right-click menu (discard, ignore, reveal, open in editor, copy path), Show whitespace toggle, 72-col ruler setting, History "Amend" on HEAD, Gerrit "Copy fetch command", Welcome identity form, create branch from selected.
- R20: error banner with Show details / Copy / Retry using `GitError.kind` + redacted stderr.

## Accepted / deferred
- **S3** Unsigned updates trust the release host — accepted until signing certs exist (RELEASE.md: enable 2FA, protect tags).
- **S12** Bidi markers in file names/branches/subjects — later.
- Sign/publish job split — later, with signing.
