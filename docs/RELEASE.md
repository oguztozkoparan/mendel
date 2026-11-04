# Releasing mendel

Releases and the in-app update feed use GitHub `oguztozkoparan/mendel` (`publish:` in `electron-builder.yml`);
switch to the `generic` HTTPS feed shown there to host elsewhere.

## Cut a release
1. On an up-to-date, clean `main`: `npm run release -- <major|minor|patch>`.
   It checks the tree and branch, runs `typecheck` and `test`, then `npm version` commits `feat(release): vX.Y.Z` and tags `vX.Y.Z`. Nothing is pushed.
2. `git push --follow-tags`.
3. `.github/workflows/release.yml` runs on the tag: verifies the tag is on `main`, builds macOS (dmg + zip, arm64 + x64), Windows (nsis x64) and Linux (AppImage + deb x64), uploads everything plus `latest*.yml` to a **draft** GitHub Release, then sets its notes from `node scripts/changelog.mjs vX.Y.Z` (`feat(...)` → Features, `bug(...)` → Fixes since the previous tag).

## Publish the draft
GitHub → Releases → the `vX.Y.Z` draft → check assets and notes → **Publish release**.
Installed apps see the update only after this (they never read drafts).

## Signing
Unsigned builds still release. Add these repository secrets and the next tag builds signed:

| Secret | Effect |
|---|---|
| `CSC_LINK`, `CSC_KEY_PASSWORD` | macOS Developer ID certificate (base64 .p12 or https link) and its password |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | macOS notarization |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | Windows code-signing certificate |

With `CSC_LINK` and `APPLE_ID` set, the macOS build is made with `MENDEL_MAC_AUTOINSTALL=true`, so the app downloads and installs updates itself. Without them, macOS shows the update and "Download" opens the release page (Squirrel.Mac refuses unsigned updates). Windows and Linux AppImage self-update either way; `.deb` always opens the download page.

Unverified until the first signed run: that electron-builder 26 notarizes from the `APPLE_*` env alone; if it does not, add `mac.notarize: true` (and `mac.hardenedRuntime: true`) to `electron-builder.yml`.

Secrets never appear in logs; keep them out of `run:` lines.

## CI hardening
- Checkouts use `persist-credentials: false`; installs run with `ignore-scripts=true` (`.npmrc`), Electron's binary comes from an explicit `npx install-electron` step (CI e2e only; electron-builder fetches its own).
- The `draft` job creates the tag's draft release once (`gh release create --draft --verify-tag`) before the build matrix uploads into it; each build checks the packaged app's fuses (`@electron/fuses read`). CI fails on `npm audit --omit=dev --audit-level=high`; Dependabot proposes npm and Actions updates weekly.
- Deferred: splitting signing (secrets) and publishing (`contents: write`) into separate jobs, so the job holding signing secrets has no write token. Do it when signing certificates are added.
