// react-markdown: builds React elements (no innerHTML), raw HTML is not rendered, unsafe URLs dropped (TECH.md §3, §6.7).
import ReactMarkdown from 'react-markdown'

/** Untrusted Gerrit comment text. Links open via main's allowlist (configured Gerrit only); images are never loaded. */
export function Markdown({ repo, text }: { repo: string; text: string }) {
  return (
    <ReactMarkdown
      skipHtml
      components={{
        a: ({ href, children }) => (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault()
              if (href) void window.mendel['gerrit:open']({ repo, path: href })
            }}
          >
            {children}
          </a>
        ),
        img: ({ alt }) => <span>{alt ? `[image: ${alt}]` : '[image]'}</span>
      }}
    >
      {text}
    </ReactMarkdown>
  )
}
