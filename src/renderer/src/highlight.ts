import { refractor } from 'refractor/core'
import bash from 'refractor/bash'
import c from 'refractor/c'
import cpp from 'refractor/cpp'
import csharp from 'refractor/csharp'
import css from 'refractor/css'
import diff from 'refractor/diff'
import docker from 'refractor/docker'
import go from 'refractor/go'
import ini from 'refractor/ini'
import java from 'refractor/java'
import javascript from 'refractor/javascript'
import json from 'refractor/json'
import jsx from 'refractor/jsx'
import kotlin from 'refractor/kotlin'
import less from 'refractor/less'
import markdown from 'refractor/markdown'
import markup from 'refractor/markup'
import php from 'refractor/php'
import python from 'refractor/python'
import ruby from 'refractor/ruby'
import rust from 'refractor/rust'
import scss from 'refractor/scss'
import sql from 'refractor/sql'
import swift from 'refractor/swift'
import toml from 'refractor/toml'
import tsx from 'refractor/tsx'
import typescript from 'refractor/typescript'
import yaml from 'refractor/yaml'
import { createElement, type ReactNode } from 'react'
import { tokenize, type HunkData, type HunkTokens, type TokenNode } from 'react-diff-view'

// Only these grammars are bundled; anything else renders as plain text.
for (const g of [bash, c, cpp, csharp, css, diff, docker, go, ini, java, javascript, json, jsx, kotlin, less, markdown, markup, php, python, ruby, rust, scss, sql, swift, toml, tsx, typescript, yaml])
  refractor.register(g)

const EXT: Record<string, string> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'tsx',
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'jsx',
  json: 'json', jsonc: 'json', css: 'css', scss: 'scss', less: 'less',
  html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup', plist: 'markup', vue: 'markup',
  md: 'markdown', markdown: 'markdown', yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'ini', cfg: 'ini',
  py: 'python', java: 'java', kt: 'kotlin', kts: 'kotlin', go: 'go', rs: 'rust',
  c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', cs: 'csharp', swift: 'swift',
  rb: 'ruby', php: 'php', sh: 'bash', bash: 'bash', zsh: 'bash', sql: 'sql', diff: 'diff', patch: 'diff'
}
const NAME: Record<string, string> = { dockerfile: 'docker', '.gitconfig': 'ini', '.editorconfig': 'ini', gemfile: 'ruby', rakefile: 'ruby' }

/** Prism grammar for a file path, by extension (or a few well-known names); undefined = plain text. */
export function languageOf(path: string): string | undefined {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase()
  const dot = name.lastIndexOf('.')
  return NAME[name] ?? (dot > 0 ? EXT[name.slice(dot + 1)] : undefined)
}

// Highlighting re-parses both sides of the diff; past this many changed lines it is skipped (plain text).
const MAX_HIGHLIGHT_CHANGES = 5000

/** Syntax tokens for react-diff-view's `tokens` prop, or undefined (plain) for unknown languages and huge diffs. */
export function highlight(hunks: HunkData[], path: string): HunkTokens | undefined {
  const language = languageOf(path)
  if (!language || !hunks.length || hunks.reduce((n, h) => n + h.changes.length, 0) > MAX_HIGHLIGHT_CHANGES) return undefined
  try {
    // refractor 5 returns a hast root; react-diff-view expects its children (the refractor 2/3 shape).
    return tokenize(hunks, { highlight: true, language, refractor: { highlight: (text: string, lang: string) => refractor.highlight(text, lang).children as never } })
  } catch {
    return undefined
  }
}

/** Per-line tokens for whole-file text (blame), via the same tokenizer on an all-context hunk. */
export const highlightLines = (lines: string[], path: string) =>
  highlight(
    [{ content: '', oldStart: 1, oldLines: lines.length, newStart: 1, newLines: lines.length, changes: lines.map((content, i) => ({ type: 'normal', isNormal: true, oldLineNumber: i + 1, newLineNumber: i + 1, content })) }],
    path
  )?.new

export const renderTokens = (nodes: TokenNode[]): ReactNode[] =>
  nodes.map((n, i) => (n.type === 'text' ? n.value : createElement('span', { key: i, className: n.properties?.className?.join(' ') }, renderTokens(n.children ?? []))))
