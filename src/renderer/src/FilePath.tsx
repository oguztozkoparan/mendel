import c from './Changes.module.css'
import { fullPath, splitPath } from './paths'

/**
 * A file list row's path: the name first, then its folder in muted text, which is cut off first. A rename/copy
 * shows both sides of what differs. The full path is the tooltip; `className` is the row's flexible path cell.
 */
export function FilePath({ path, orig, className }: { path: string; orig?: string; className: string }) {
  const [dir, name] = splitPath(path)
  const [oDir, oName] = orig ? splitPath(orig) : [dir, name]
  const full = fullPath(path, orig)
  return (
    // a root file without rename shows its full path; the automatic tooltip covers it when cut off
    <span className={`${className} ${c.split}`} data-tip={full !== name ? full : undefined}>
      <span className={c.fileName}>{oName === name ? name : `${oName} → ${name}`}</span>
      {(dir || oDir) && <span className={c.fileDir}>{oDir === dir ? dir : `${oDir || '(root)'} → ${dir || '(root)'}`}</span>}
    </span>
  )
}
