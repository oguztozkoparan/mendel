import { describe, expect, it } from 'vitest'
import { diffStat } from '../../src/renderer/src/diffStat'

describe('diffStat', () => {
  it('counts hunk lines, not the ---/+++ headers, across sections', () => {
    const raw = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,2 +1,3 @@\n a\n-b\n+b2\n+++c\n\\ No newline at end of file\n'
    expect(diffStat([raw, '@@ -1 +1 @@\n-x\n+y\n'])).toEqual({ a: 3, d: 2 })
  })
  it('is null for a binary diff', () => {
    expect(diffStat(['diff --git a/i b/i\nBinary files a/i and b/i differ\n'])).toBeNull()
  })
})
