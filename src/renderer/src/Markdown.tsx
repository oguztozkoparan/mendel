// react-markdown: builds React elements (no innerHTML), raw HTML is not rendered, unsafe URLs dropped (TECH.md §3, §6.7).
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import md from './Markdown.module.css'

/**
 * Untrusted Markdown text (Gerrit comments, GitHub pull request bodies, commit messages). `link` renders every link: the
 * caller opens it through main's allowlist; images are never loaded. `gfm`: tables, task lists, strikethrough, bare-URL
 * autolinks. Raw HTML is never rendered: dropped, or with `htmlAsText` shown as the literal text it is (a commit message
 * saying `<executable>` or `Map<String, Foo>` must not lose words).
 */
export function Markdown({ text, link, gfm, htmlAsText }: { text: string; link: Components['a']; gfm?: boolean; htmlAsText?: boolean }) {
  return (
    <ReactMarkdown
      skipHtml={!htmlAsText}
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
