// react-markdown: builds React elements (no innerHTML), raw HTML is not rendered, unsafe URLs dropped (TECH.md §3, §6.7).
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import md from './Markdown.module.css'

/**
 * Untrusted Markdown text (Gerrit comments, GitHub pull request bodies). `link` renders every link: the caller opens it
 * through main's allowlist; images are never loaded. `gfm`: tables, task lists, strikethrough, bare-URL autolinks.
 */
export function Markdown({ text, link, gfm }: { text: string; link: Components['a']; gfm?: boolean }) {
  return (
    <ReactMarkdown
      skipHtml
      remarkPlugins={gfm ? [remarkGfm] : []}
      components={{
        a: link,
        img: ({ alt }) => <span className={md.image}>{alt ? `[image: ${alt}]` : '[image]'}</span>
      }}
    >
      {text}
    </ReactMarkdown>
  )
}
