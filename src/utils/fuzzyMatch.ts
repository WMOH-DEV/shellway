function isSubsequence(needle: string, haystack: string): boolean {
  let position = 0
  for (const char of needle) {
    position = haystack.indexOf(char, position) + 1
    if (position === 0) return false
  }
  return true
}

export function matchesFuzzy(query: string, haystack: string): boolean {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  const text = haystack.toLowerCase()
  return terms.every((term) => isSubsequence(term, text))
}
