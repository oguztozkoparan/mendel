# Mendel (cross-platform desktop git client with per-host provider plugins)

## Stack
- Electron + React + Vite + TypeScript. Git ops shell out to the system `git` CLI (hooks, SSH keys, credentials behave like the terminal).
- Providers in `src/main/providers/<name>/` activate when a repo's remote matches (first: Gerrit; later: GitHub, Bitbucket).
- Plan: `docs/PLAN.md` · tech/security decisions: `docs/TECH.md`.

## Commands
- install: `npm ci` (Electron binary downloads on first run; force with `npx install-electron`)
- dev: `npm run dev` · build: `npm run build` · typecheck: `npm run typecheck` (`tsc -b`)
- test: `npm test` (vitest unit + git integration) · single file: `npx vitest run test/unit/<file>.test.ts`
- e2e: `npm run e2e` (builds with `--mode e2e`, then Playwright `_electron` against `out/main/index.js`) · single: `npx playwright test test/e2e/<file>.spec.ts` after an e2e-mode build (`npx electron-vite build --mode e2e`; a plain `npm run build` compiles the test seams out)
- package: `npm run dist` (electron-builder, `electron-builder.yml`) · release: `npm run release -- <major|minor|patch>`

## Commits
- Feature: `feat(<scope>): <description>` · bug fix: `bug(<scope>): <description>`. No other prefixes. Enforced by `scripts/commit-msg` (installed to `.git/hooks/commit-msg`).
- One feature or fix per commit.

## Tooling
- graphify: locate code with `graphify query "<q>"`, `graphify explain <Node>`, `graphify path <A> <B>` before grep/glob/read. Graph rebuilds on commit/checkout via git hook.
- rtk: shell commands are rewritten through rtk by a global hook for compact output. Don't bypass it; if you truly need raw output, say why.
- caveman: terse response style is on. Keep code, paths, commands and error messages verbatim.
- ponytail: smallest complete change; no unrequested abstraction.
- headroom: context-compression proxy outside the session; nothing to do.

## Rules
- Minimal diffs. No unrequested refactors, renames or "while I was here" changes; flag spotted issues in one line.
- Security first: renderer has no Node access (contextIsolation, sandbox, no nodeIntegration); all git/network/secrets go through typed IPC in main; never build shell strings, pass git args as arrays; secrets only via OS keychain (`safeStorage`).
- Never read or print `.env*` or secrets.
- Tests per change/commit: `npm run typecheck` + `npm test` (fast, always all) + only the e2e specs the change can affect. Full `npm run e2e` once at the end of a task (and after merges), not before every commit.
- Do not push unless explicitly asked.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.
