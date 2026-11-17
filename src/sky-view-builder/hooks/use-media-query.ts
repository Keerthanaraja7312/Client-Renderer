import * as React from "react"

/**
 * Reactive `window.matchMedia` wrapper. Returns `defaultValue` during SSR /
 * first render, then the live match state, updating whenever the viewport
 * crosses the query's boundary (window resize, DevTools docking, rotation).
 */
export function useMediaQuery(query: string, defaultValue = false): boolean {
  const [matches, setMatches] = React.useState<boolean>(() =>
    typeof window === "undefined" ? defaultValue : window.matchMedia(query).matches
  )

  React.useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [query])

  return matches
}