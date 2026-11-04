# gitdock: technology & security decisions

Status: decided 2026-11-04. Versions verified with `npm view <pkg> version` on that date (pin exact in `package.json`, update via PR).
Marked **[unverified]** = from memory or secondary source; check before relying on it.

Principles: fewest dependencies; nothing added for a few lines of code; renderer is untrusted UI, `main` owns git, network, secrets and disk.

---

## 1. Scaffold, build, packaging

| Choice | Version | Why | Rejected |
|---|---|---|---|
| `electron` | 45.2.2 (Node 24.22, Chromium 156) | Current stable; only the latest 3 majors get security fixes. | Older majors: unpatched. |
| `electron-vite` | 6.0.0 | One config for main/preload/renderer on Vite 8, HMR for renderer, hot restart for main. Thin, no runtime deps in app. | Electron Forge 8 + Vite plugin (stable since Forge 8): fine builder, but its makers/updater path (Squirrel.Windows, update.electronjs.org) has no AppImage, no generic-URL feed and no NSIS differential updates. Manual Vite: re-implements what electron-vite does. |
| `vite` | 8.3.5 | Required by electron-vite / plugin-react. | — |
| `@vitejs/plugin-react` | 6.2.1 | Official React plugin (Vite 8 / oxc). | `plugin-react-swc`: extra native dep, no gain. |
| `typescript` | 6.0.3 | Last JS-based compiler; full ecosystem compat (typescript-eslint peer is `<6.1`). | 7.0.2 (Go native): faster, but tooling relying on the TS JS API is not ready. Revisit in 2027. |
| `electron-builder` | 26.18.0 | DMG+ZIP / NSIS / AppImage+deb from one config, built-in `electronFuses`, ASAR integrity, first-class `electron-updater` metadata (`latest*.yml`) for GitHub and generic hosts. | Forge makers (see above). Note: v27 is in alpha (`next` = 27.0.0-alpha.14) and adds an Ed25519-signed update manifest; move when stable. |

Layout:

```
src/
  main/            # Electron main: windows, menu, IPC handlers, updater
    git/           # execFile wrapper, arg builders, porcelain parsers
    providers/     # <name>/ provider plugins (gerrit first), matched by remote URL
    ipc/           # one file per channel group; zod schemas live in src/shared
  preload/         # contextBridge: exposes typed `window.gitdock` only
  renderer/        # React app (no Node, no Electron imports)
  shared/          # types + zod IPC schemas + channel names (no runtime deps on main/renderer)
test/              # unit + integration (vitest), e2e/ (playwright), fixtures/ (gerrit mock)
scripts/           # commit-msg, changelog.mjs
electron-builder.yml, electron.vite.config.ts
```

## 2. UI with native OS feel

**Decision: `react-aria-components` 1.22.1 + plain CSS Modules (Vite built-in) + `lucide-react` 1.68.0 icons.**

- Why: React Aria gives the best accessibility/keyboard/focus behavior (Adobe, ARIA-compliant, RTL, typeahead, collections) and is **unstyled**, so we can style per platform instead of shipping one web look everywhere. Tree-shakes to what we use.
- Native look comes from the OS, not a kit: system font stack (`-apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", system-ui`), `<html data-platform="darwin|win32|linux">` with per-platform CSS tokens (radii, control heights, focus rings: mac 6px/accent ring, Windows 4px/2px outline), OS accent color via `systemPreferences.getAccentColor()` (mac/win) pushed as `--accent`, CSS `color-scheme: light dark` + `prefers-color-scheme` (Chromium follows `nativeTheme` automatically).
- Rejected:
  - Fluent UI v9 (`@fluentui/react-components` 9.75.1): excellent on Windows, looks foreign on macOS; Griffel CSS-in-JS runtime; ~2.2 MB unpacked.
  - Radix/shadcn + Tailwind 4.3.4: generic "web SaaS" look, adds Tailwind toolchain; Radix a11y good but React Aria stronger on collections/keyboard.
  - Mantine 9.7.4: web look, larger runtime, CSS-in-JS-ish theming.
- Icons: `lucide-react` (ISC, tree-shaken, ~1 KB/icon). Rejected `@fluentui/react-icons` (Windows-styled, huge package).

Native Electron features to use (no deps):

| Feature | API | Notes |
|---|---|---|
| App menu | `Menu.setApplicationMenu` with roles (`appMenu`, `editMenu`, `windowMenu`) | mac: standard app menu; win/linux: in-window menu bar (auto-hide optional). Accelerators for fetch/pull/push/commit. |
| Context menus | `Menu.popup` in main | Renderer sends item ids via IPC; main shows native menu and returns the chosen id. |
| Dialogs | `dialog.showOpenDialog` (pick repo/folder), `showMessageBox` (confirm discard/force-push/delete branch) | Native confirmations for destructive ops. |
| Notifications | `Notification` (main) | Push done/failed, new Gerrit review requests. No renderer `Notification` permission. |
| Theme | `nativeTheme.themeSource = 'system'` (+ user override), listen `updated` | |
| Title bar | mac `titleBarStyle: 'hiddenInset'`, `trafficLightPosition`; win/linux `titleBarStyle: 'hidden'` + `titleBarOverlay: { color, symbolColor, height }` | Toolbar in title area (`-webkit-app-region: drag`, buttons `no-drag`). Update overlay colors on theme change. |
| Materials | mac `vibrancy: 'sidebar'`; Win11 `backgroundMaterial: 'mica'` | Sidebar only; keep content opaque for diff legibility. |
| Window state | own ~20 lines in settings JSON (bounds, maximized); clamp to `screen.getDisplayMatching(...).workArea` | Rejected `electron-window-state` 5.0.3: unmaintained since 2022. |
| Dock badge | `app.setBadgeCount` (mac/Linux Unity), Windows `win.setOverlayIcon` | Count of Gerrit changes needing my review. |
| Progress | `win.setProgressBar` | Clone/fetch progress (parse `--progress` stderr). |
| Recent repos | `app.addRecentDocument` | mac Dock menu / Windows Jump List. |
| External links | `shell.openExternal` only via allowlist (see §6) | |
| Single instance | `app.requestSingleInstanceLock` | |
| Tray | **not used** | No background-only use case. |

## 3. Core libraries

| Area | Decision | Version | Why | Rejected |
|---|---|---|---|---|
| Diff view | `react-diff-view` | 3.3.3 | Split + unified views, React elements (no `innerHTML`), widgets for inline Gerrit comments, small. Parse with its bundled `parseDiff`. | Monaco diff (0.57.0): multi-MB, web workers, CSP needs `worker-src blob:`, editor we do not need. `diff2html` 3.4.56: produces HTML strings → `innerHTML`. |
| Large diffs | own rules, no dep | — | `git diff --numstat -z` first; load file diffs lazily per file; collapse files > 2 000 changed lines or > 1 MB behind "Load diff"; binary via numstat `-`. Syntax highlighting deferred. | — |
| Virtualization | `@tanstack/react-virtual` | 3.14.26 | Headless, ~10 KB; commit log, file lists, change lists. | `react-window`: fixed-API, less flexible for variable rows. |
| Async state | `@tanstack/react-query` | 5.105.3 | Cache + invalidation for IPC calls (status, log, Gerrit queries), refetch on window focus, retries. Plain React state for UI state. | Zustand/Redux: not needed. Hand-rolled cache: re-invents invalidation. |
| Routing | **none** | — | Single window, view state in React. | react-router 8.5.1, TanStack Router: overkill. |
| IPC validation | `zod` | 4.6.7 | Schemas in `src/shared`, parsed in **main** for every payload; types inferred for preload/renderer. Size irrelevant in main. | `valibot` 1.5.0: smaller, but size does not matter in main; zod has better errors/ecosystem. |
| Markdown (Gerrit comments) | `react-markdown` (+ no `rehype-raw`) | 10.1.0 | Builds React elements, never `innerHTML`; raw HTML ignored by default; default `urlTransform` drops `javascript:` etc. Safe by construction. | `marked` 18.1.3 + `dompurify` 3.4.17: fewer packages but relies on `innerHTML` + sanitizer config being right. Note: react-markdown pulls the unified ecosystem (~50 small transitive deps) — accepted for safety. `remark-gfm` 4.0.1 only if Gerrit content needs tables. |
| Git | own wrapper on `child_process.execFile`/`spawn` (~150 lines) | — | System git (hooks, SSH, credential helpers like terminal), full control of args/env, streaming for progress. | `simple-git` 4.0.2: abstraction we must audit anyway, history of argument-injection CVEs (CVE-2022-24433, CVE-2022-25912 **[unverified ids]**). `dugite` 3.3.2: bundles git (+~50 MB/platform) and diverges from terminal behavior. |
| Missing git (Windows) | detect at startup, show dialog: "Install Git for Windows" → https://git-scm.com/download/win or `winget install Git.Git`; re-check button | — | Keeps one git. Warn if `git --version` < 2.50.1 (security fixes, see §6). | Bundling dugite as fallback: revisit only if users ask. |
| Keychain | Electron `safeStorage` **async API** | built-in | `encryptStringAsync`/`decryptStringAsync`; the sync API is deprecated in Electron 45 and **removed in 46**. Encrypted blobs stored in userData. | `keytar` 7.9.0: archived, native module. |
| Settings | own tiny JSON file in `app.getPath('userData')`, zod-validated, atomic write (tmp + `rename`) | — | ~40 lines. | `electron-store` 12.0.0: ESM + deps for something trivial. |
| Logging | `electron-log` | 5.4.4 | Zero deps, file rotation, main+renderer, per-OS log path. Wrap with a redaction hook (§6). | Own logger: rotation/crash flush is more than a few lines. |
| Toolkit helpers | none | — | — | `@electron-toolkit/*`: wraps a few lines each. |

## 4. Auto-update and release

**Runtime: `electron-updater` 6.8.11**, `autoDownload = false`, `autoInstallOnAppQuit = true` (win/linux). Check on start (+30 s), every 6 h, and from menu "Check for Updates…". UI: banner "gitdock X.Y.Z available" → [Download] → progress → [Restart to update] (`quitAndInstall`).

Providers (in `electron-builder.yml`, `publish:`):
- GitHub: `{ provider: github, owner, repo }`. Public repo only (private needs a token in the app: do not).
- Generic static URL: `{ provider: generic, url: https://downloads.example.com/gitdock/ }`; upload `latest*.yml`, installers, `.blockmap` to that path (any HTTPS static host / S3 / R2). Switch provider via `-c.publish.provider=generic` in CI, no code change.

What works **unsigned**:

| OS | Behavior | gitdock UX |
|---|---|---|
| macOS | Squirrel.Mac **refuses to install unsigned updates** (electron-builder docs: "macOS application must be signed in order for auto updating to work"). Check works (reads `latest-mac.yml`). | Build flag `GITDOCK_MAC_AUTOINSTALL=false` (until signed): on `update-available` show [Open download page] → `shell.openExternal` of the release page (GitHub: `releases/tag/vX.Y.Z`; generic: `<url>/gitdock-X.Y.Z-<arch>.dmg`). Help text: first launch needs System Settings → Privacy & Security → "Open Anyway" (ctrl-click bypass removed in macOS 15 **[unverified for 26]**). Keychain may re-prompt after each update (no stable signature). |
| Windows | NSIS install/update works. SmartScreen "Windows protected your PC" on first install (More info → Run anyway). Updater signature check is skipped when unsigned. | Normal auto-update flow. |
| Linux | AppImage self-updates. `.deb` cannot (needs root). | AppImage: auto. deb: notify + open download page. |

Integrity: HTTPS + `sha512` per file in `latest*.yml` (checked by electron-updater). Unsigned, the yml and binary come from the same host, so host compromise = update compromise. Mitigations: GitHub Releases with 2FA + `contents: write` only in the release job; move to electron-builder 27 signed manifest when stable.

Build targets: mac `dmg` + `zip` (zip is **required** for `latest-mac.yml`), arch `arm64` and `x64`; win `nsis` x64 (+arm64 later); linux `AppImage` + `deb` x64.

Release process (in repo):
1. `npm run release -- minor` → `npm version -m "feat(release): v%s" minor` (message passes `scripts/commit-msg`; the default `npm version` message `1.2.0` would be rejected) → commit + tag `v1.2.0`; then `git push --follow-tags`.
2. `.github/workflows/release.yml` on `push: tags: ['v*']`, matrix `macos-latest`, `windows-latest`, `ubuntu-latest`: checkout → setup-node 24 → `npm ci` → `npm run typecheck && npm test` → `npx electron-builder --publish always` (`GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}`, `permissions: contents: write`). electron-builder creates/updates a **draft** release.
3. Final job (`needs: build`): `node scripts/changelog.mjs v<prev> v<new> > notes.md` then `gh release edit v<new> --notes-file notes.md --draft=false`.
4. Pin all third-party actions by commit SHA.

Changelog: `scripts/changelog.mjs` (~30 lines, no dep): `git log --format=%s%x1f%h prev..tag`, group `feat(...)` → "Features", `bug(...)` → "Fixes", skip `feat(release)`. Rejected `git-cliff` 2.14.2 (extra binary for a 30-line script), `conventional-changelog-cli` 5.0.0 (does not know the `bug` type without a custom preset).

Once certificates exist:
- macOS: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` secrets; `mac.hardenedRuntime: true`, `mac.notarize: true`; drop `GITDOCK_MAC_AUTOINSTALL=false` → full Squirrel.Mac auto-install; Gatekeeper and Keychain prompts go away.
- Windows: Azure Trusted Signing (`win.azureSignOptions`) or an OV/EV cert; set the publisher name so electron-updater verifies Authenticode of the update against the running app's publisher; SmartScreen reputation builds.
- Linux: optionally GPG-sign deb/AppImage; set `allowUnverifiedLinuxPackages: false`.

## 5. Testing

| Layer | Tool | Version | Scope |
|---|---|---|---|
| Unit | `vitest` | 5.1.0 | git arg builders, porcelain v2 / `-z` parsers (fixture strings), zod schemas, ref-name validation, URL redaction, Gerrit client (against mock), changelog script. `environment: node`. |
| Git integration | `vitest` + real system git | — | `fs.mkdtemp` → `git init --bare remote.git` + work clone; run our wrapper end to end (commit, branch, fetch, pull --rebase, push, conflicts). Isolate from dev config: `HOME=<tmp>`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=<tmp>/gitconfig` with `user.name/email`, `init.defaultBranch=main`. |
| E2E | `@playwright/test` (`_electron`) | 1.64.1 | `_electron.launch({ args: ['out/main/index.js'], env })` against the built app; same temp-repo fixtures; test-only userData dir via `GITDOCK_E2E_USERDATA` honored **only when `!app.isPackaged`**. Note `_electron` is marked experimental by Playwright. |
| Gerrit (default) | mock server, `node:http`, no dep | — | `test/fixtures/gerrit-mock.ts`: `/a/accounts/self`, `/a/changes/?q=…`, `/a/changes/{id}/revisions/current/review`, comments; prefixes `)]}'\n`; checks Basic auth; records requests for assertions. Push to `refs/for/main`: remote URL is `https://gerrit.test/project` (so provider auto-activates), test gitconfig maps it to a local bare repo with `url."<tmp>/remote.git".insteadOf=https://gerrit.test/project`; bare repo has `receive.advertisePushOptions=true`; assert ref `refs/for/main` and push options (`%topic=`, `-o topic=`). |
| Gerrit (optional) | `docker run -p 8080:8080 -p 29418:29418 gerritcodereview/gerrit:3.1.3` (also 3.14.5) | 3.1.3 = older 3.x servers still common; 3.14.5 = latest stable | Feasible: dev-mode auth (`DEVELOPMENT_BECOME_ANY_ACCOUNT`) is the image default; script creates admin token, project, user via REST. Boot ~1–2 min **[unverified]**, whole job ~5–10 min. Run nightly / manual `workflow_dispatch` on ubuntu, not on PRs. Also covers Gerrit 3.13+ auth tokens (see §6). |

CI (`.github/workflows/ci.yml`, PRs): matrix 3 OS → `npm ci`, `typecheck`, `test`, `build`, `e2e`.
- Linux: `xvfb-run --auto-servernum npm run e2e`.
- Ubuntu 24.04 runners restrict unprivileged user namespaces (AppArmor), which breaks Chromium's sandbox: run `sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` in CI instead of `--no-sandbox` **[unverified for current runner image]**.
- Upload `test-results/` + Playwright traces on failure.

## 6. Security checklist (mandatory)

Sources: [Electron security checklist](https://www.electronjs.org/docs/latest/tutorial/security), [Electron fuses](https://www.electronjs.org/docs/latest/tutorial/fuses), [ASAR integrity](https://www.electronjs.org/docs/latest/tutorial/asar-integrity), [safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage), [electron-builder fuses](https://www.electron.build/docs/tutorials/adding-electron-fuses/), [electron-builder auto-update](https://www.electron.build/docs/features/auto-update/), GitHub Desktop [`lib/git/core.ts`](https://github.com/desktop/desktop/blob/development/app/src/lib/git/core.ts) and [`trampoline-environment.ts`](https://github.com/desktop/desktop/blob/development/app/src/lib/trampoline/trampoline-environment.ts), [Git security advisories](https://github.com/git/git/security/advisories).

### 6.1 Electron hardening
- [ ] `webPreferences`: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `nodeIntegrationInWorker: false`, `webSecurity: true`, `allowRunningInsecureContent: false`, `experimentalFeatures: false`, no `enableBlinkFeatures`, `webviewTag: false`, `spellcheck` ok. Call `app.enableSandbox()` before ready.
- [ ] Prod renderer served from a custom protocol `app://gitdock/` via `protocol.handle` (not `file://`); handler resolves under `out/renderer` and rejects paths escaping it. Register scheme as `standard, secure`.
- [ ] CSP as response header from the protocol handler (meta tag in dev): `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'`. Dev adds `ws://localhost:*` + Vite origin. No `unsafe-eval`, no `unsafe-inline` scripts (if a lib needs inline `<style>`, allow `'unsafe-inline'` for `style-src` only). Remote images (Gerrit avatars) are fetched in main and returned as data/blob, not loaded from remote origins.
- [ ] `app.on('web-contents-created')`: `will-navigate` → `preventDefault()` unless same app origin; `will-redirect` same; `setWindowOpenHandler(() => ({ action: 'deny' }))` (send allowlisted URLs to `openExternal` instead); `will-attach-webview` → `preventDefault()`.
- [ ] `session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))` and `setPermissionCheckHandler(() => false)`; `setDevicePermissionHandler(() => false)`.
- [ ] No `@electron/remote`; preload exposes only `contextBridge.exposeInMainWorld('gitdock', {...})` with fixed functions, never `ipcRenderer` itself or generic `invoke(channel, …)`.
- [ ] DevTools disabled in packaged builds (`devTools: !app.isPackaged`).
- [ ] Fuses via electron-builder `electronFuses` (uses `@electron/fuses` internally, no extra dep): `runAsNode: false`, `enableCookieEncryption: true`, `enableNodeOptionsEnvironmentVariable: false`, `enableNodeCliInspectArguments: false`, `enableEmbeddedAsarIntegrityValidation: true` (mac ≥16, win ≥30), `onlyLoadAppFromAsar: true`, `grantFileProtocolExtraPrivileges: false`, `loadBrowserProcessSpecificV8Snapshot: false`. Verify in CI: `npx @electron/fuses read --app <built app>`.
- [ ] `shell.openExternal(url)` only after `new URL(url)`: protocol `https:` (or `http:` only for a user-configured provider host), no credentials in URL; anything else is dropped and logged.
- [ ] Stay on a supported Electron major (latest 3); Renovate/Dependabot weekly.

### 6.2 IPC design
- [ ] One `ipcMain.handle` per narrow operation (`repo:status`, `git:commit`, `gerrit:listChanges`…); channel names + zod schemas in `src/shared/ipc.ts`.
- [ ] Every handler: (1) check `event.senderFrame` exists and `new URL(event.senderFrame.url).origin` (prefer `senderFrame.origin`) equals the app origin (`app://gitdock` / dev server), and the frame is the top frame of our window; (2) `schema.parse(payload)`; (3) only then act.
- [ ] Renderer never sends commands, argv, file paths outside a repo, or URLs to fetch. It sends ids (`repoId`, `changeId`, `path` relative to repo) that main resolves.
- [ ] Repos the renderer can address = repos the user added via native dialog (stored list); `repoId` → absolute path lookup in main.
- [ ] Errors returned to renderer are sanitized (no env, no credentials, no full argv with secrets); a `GitError` additionally carries its `kind` and redacted stderr (encoded after `IPC_ERROR_PREFIX`, decoded in preload) for the error banner.

### 6.3 Git invocation and argument injection
- [ ] Resolve git **once** to an absolute path (search `PATH` ourselves; on Windows never let CreateProcess search the repo `cwd`, which would run a planted `git.exe` — cf. Git LFS CVE-2020-27955 **[unverified id]**). Always `execFile(absGit, args, { shell: false, cwd: repoRoot, env, windowsHide: true, maxBuffer })` / `spawn` for streaming. Never a shell, never string concatenation.
- [ ] Env: inherit user env (so SSH agent/credential helpers work) plus `GIT_TERMINAL_PROMPT=0`, `LC_ALL=C` (stable parsing; use `-c i18n.logOutputEncoding=UTF-8`), `TERM=dumb` (as GitHub Desktop), `GIT_OPTIONAL_LOCKS=0` for background reads (status/log polling). Do not set `GIT_ASKPASS` to anything in v1; Desktop sets it to `''`.
- [ ] Machine-readable output: `status --porcelain=v2 -z`, `log -z --format=…`, `diff --numstat -z`.
- [ ] User-supplied revisions/refs: insert `--end-of-options` (git ≥ 2.24) before them; paths always after `--`; reject any value starting with `-`; branch names checked with `git check-ref-format --branch <name>` (and `refs/...` with `git check-ref-format`).
- [ ] Commit messages via `-F -` (stdin), not `-m` (no argv limits, no option parsing).
- [ ] Per-command allowlist of flags; user strings never go into `-c key=value`, `--upload-pack`, `--receive-pack`, `--exec`, `--config`, `--template`, or `-o`/push-option values without validation (Gerrit `topic`, `hashtag`, reviewers: `^[A-Za-z0-9._@+-]+$`).
- [ ] Clone URLs: parse; allow `https:`, `ssh:`, scp-style `user@host:path`, and local paths chosen via native dialog; reject leading `-` (CVE-2017-1000117 `ssh://-oProxyCommand`), reject `ext::`/`fd::`; pass `-c protocol.ext.allow=never` on clone/fetch/push/submodule; put URL after `--`.
- [ ] Untrusted repos: opening or polling a repo must not run repo-configured commands. Disabled: background reads (status, diff, log, show, diff-tree, for-each-ref, rev-parse, config…) pass `-c core.fsmonitor=false`; diffs use `--no-ext-diff --no-textconv`; `interpret-trailers` (Change-Id) runs with a cwd outside any repo so `trailer.<key>.cmd` is never read. Intentionally kept for terminal parity on user-started operations (commit, stage, pull, push, checkout, rebase…): hooks, clean/smudge filters (LFS), `core.fsmonitor` on those ops, `core.sshCommand`, credential helpers and other user/repo config. Do **not** set `safe.directory=*`. On "detected dubious ownership" (CVE-2022-24765 protection) show the path + owner and a "Trust this folder" button → `git config --global --add safe.directory <abs path>` after explicit confirmation (GitHub Desktop surfaces the same error, `DugiteError.UnsafeDirectory`).
- [ ] Clone of untrusted repos: do not default to `--recurse-submodules`; ask. Several git RCEs went through submodules/clone (CVE-2024-32002 symlinked submodule hooks, fixed 2.45.1; CVE-2025-48384 CR in config paths, fixed 2.50.1 **[versions unverified]**). Warn when system git < 2.50.1.
- [ ] Credential bug class to avoid: GitHub Desktop CVE-2025-23040 (credential helper fooled by `%0d` in a submodule URL → creds sent to attacker host). We implement no credential helper in v1; git's `credential.protectProtocol` (default on) applies.
- [ ] Gerrit `commit-msg` hook (Change-Id): downloading `<gerrit>/tools/hooks/commit-msg` writes executable code into `.git/hooks`. Only over HTTPS from the configured Gerrit host, after explicit user consent, write with mode 0755, show the source. Alternative without download: compute Change-Id ourselves when committing (`Change-Id: I<sha1>` trailer) — preferred, no code download.
- [ ] Kill long-running git on window close / cancel (`AbortController` → `child.kill()`), timeouts for background reads.

### 6.4 Paths
- [ ] Every repo-relative path from renderer: `path.resolve(root, p)`; reject absolute input, NUL bytes, and results where `path.relative(root, abs)` starts with `..`; for file reads, `fs.realpath` and re-check (symlinks). Prefer `git show :<path>` / `git cat-file` over fs reads.
- [ ] Discard/delete operations only through git (`git restore`, `git clean -- <path>`), never `fs.rm` on renderer-provided paths.

### 6.5 Credentials
- [ ] Gerrit HTTP password **or Gerrit ≥3.13 auth token** (same Basic auth; 3.13 deprecates HTTP passwords in favor of expiring tokens — UI label "HTTP password / token", show expiry errors clearly).
- [ ] Stored only in main: `safeStorage.encryptStringAsync` → blob in userData; decrypt on demand; never sent to renderer (renderer gets `hasCredential: boolean`), never logged, never in argv or env of git.
- [ ] Linux: if `safeStorage.getSelectedStorageBackend() === 'basic_text'`, refuse to persist (session-only) and tell the user to install/enable a keyring.
- [ ] Git transport auth uses the user's own credential helper/SSH (same as terminal). If push fails with auth and the user has a stored Gerrit token, offer "Save to git credential helper" → `git credential approve` via stdin, with consent. An askpass trampoline (GitHub Desktop style) is deferred.
- [ ] Logger redaction hook: strip `userinfo` from URLs (`https://user:pass@` → `https://***@`), `Authorization:` headers, `?access_token=`; applied to log lines and to error messages sent to the renderer.

### 6.6 Network / TLS
- [ ] Gerrit REST from main with Electron `net.fetch` (Chromium stack: OS cert store incl. corporate CAs, system proxy, PAC). Not Node `fetch` (bundled CA list, no system proxy).
- [ ] Never `setCertificateVerifyProc` to accept, never handle `certificate-error` with `callback(true)`, never `NODE_TLS_REJECT_UNAUTHORIZED=0`. Custom CA = install in the OS store.
- [ ] Gerrit responses: strip the `)]}'` XSSI prefix only if present at offset 0, then `JSON.parse`, then zod-validate the fields we use. Use the `/a/` authenticated prefix. Size cap and timeout on responses.
- [ ] Provider base URL must be `https:` (allow `http:` only for `localhost` in dev/tests).

### 6.7 Untrusted content rendering
- [ ] Gerrit comments, commit messages, file names, diffs are untrusted: render as React text or via `react-markdown` without `rehype-raw`. `dangerouslySetInnerHTML` is banned (grep in CI); if ever unavoidable, DOMPurify with an explicit allowlist.
- [ ] Links in rendered markdown go through the `openExternal` allowlist; images in comments are not loaded remotely.
- [ ] Diff content with control characters / bidi (Trojan Source) shown with a visible marker.

### 6.8 Update integrity
- [ ] HTTPS-only feed; electron-updater verifies `sha512` from `latest*.yml`; never set `allowDowngrade`; no NSIS web installer.
- [ ] Once signed: Windows Authenticode publisher check, macOS Squirrel signature check, notarization.
- [ ] Release job is the only one with `contents: write`; release requires tag on `master`; actions pinned by SHA.

### 6.9 Dependency hygiene
- [ ] Commit `package-lock.json`; CI uses `npm ci`; `npm audit --omit=dev --audit-level=high` fails CI.
- [ ] `.npmrc`: `ignore-scripts=true`. Electron 45 has no install script (binary downloads on first run); CI fetches it explicitly with `npx install-electron`. No app dependency is native, so no `install-app-deps`.
- [ ] Dependabot (npm + github-actions) weekly.
- [ ] `npx @doyensec/electronegativity@1.10.3 -i src` as an advisory CI step (tool unmaintained since 2023; useful but not authoritative).
- [ ] New runtime dependency needs a one-line justification in this file.

## 7. package.json

`dependencies` (bundled into the renderer/main by Vite; kept in `dependencies` so electron-builder's dependency handling is unambiguous):

```json
{
  "@tanstack/react-query": "5.105.3",
  "@tanstack/react-virtual": "3.14.26",
  "electron-log": "5.4.4",
  "electron-updater": "6.8.11",
  "lucide-react": "1.68.0",
  "react": "19.3.1",
  "react-aria-components": "1.22.1",
  "react-diff-view": "3.3.3",
  "react-dom": "19.3.1",
  "react-markdown": "10.1.0",
  "zod": "4.6.7"
}
```

`devDependencies`:

```json
{
  "@playwright/test": "1.64.1",
  "@types/node": "24.19.2",
  "@types/react": "19.3.0",
  "@types/react-dom": "19.3.0",
  "@vitejs/plugin-react": "6.2.1",
  "electron": "45.2.2",
  "electron-builder": "26.18.0",
  "electron-vite": "6.0.0",
  "typescript": "6.0.3",
  "vite": "8.3.5",
  "vitest": "5.1.0"
}
```

`@types/node` tracks Electron's Node (24.x), not latest (26.x). No ESLint for now (none requested); add `eslint` 10.14.0 + `typescript-eslint` 8.72.1 later if wanted.

Scripts:

| Name | Command |
|---|---|
| `dev` | `electron-vite dev` |
| `build` | `electron-vite build` |
| `typecheck` | `tsc -b` (project refs: `tsconfig.node.json` for main/preload/shared, `tsconfig.web.json` for renderer) |
| `test` | `vitest run` |
| `e2e` | `npm run build && playwright test` |
| `dist` | `npm run build && electron-builder --publish never` |
| `release` | `npm version -m "feat(release): v%s"` (run `npm run release -- minor`; npm appends the arg). Then push manually: `git push --follow-tags` |

## Open questions / risks
1. Repo host undecided: GitHub provider assumes a **public** repo; private GitHub or internal host → use the generic provider on an HTTPS static host.
2. Unsigned macOS: no in-app install, Gatekeeper friction, Keychain re-prompts after updates. Apple Developer ID ($99/yr) removes all three.
3. Unsigned update integrity rests on release-host security only.
4. Gerrit auth: support both HTTP password and 3.13+ tokens; token expiry UX needed.
5. Syntax highlighting in diffs deferred (would add `refractor`).
6. Electron 46 removes sync `safeStorage` — use async API from day one.
