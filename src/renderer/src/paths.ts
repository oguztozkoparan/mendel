/** Repo-relative path → [folder, name]. git and Gerrit always use '/'; a trailing one (directory or submodule entry) stays on the name. */
export function splitPath(path: string): [string, string] {
  const i = path.lastIndexOf('/', path.length - 2)
  return i < 0 ? ['', path] : [path.slice(0, i), path.slice(i + 1)]
}

/** The whole path as text (a rename/copy: both sides): the row's tooltip and accessible name. */
export const fullPath = (path: string, orig?: string) => (orig ? `${orig} → ${path}` : path)
