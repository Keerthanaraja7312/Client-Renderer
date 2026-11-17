/**
 * Runtime environment configuration.
 *
 * This utility provides a unified way to access environment variables,
 * prioritizing runtime variables injected via window.__ENV__ and
 * falling back to Vite's build-time environment variables (import.meta.env).
 *
 * In production (Docker), variables are injected into window.__ENV__ at runtime.
 * During development, we default to import.meta.env.
 */

declare global {
  interface Window {
    __ENV__?: Record<string, string>
  }
}

const getEnv = (key: string): string => {
  // Check if window.__ENV__ exists and has the requested key
  if (window.__ENV__ && window.__ENV__[key] !== undefined) {
    const value = window.__ENV__[key]
    // Favor runtime value if it is not a shell template placeholder
    if (value && !value.startsWith("${")) {
      return value
    }
  }

  // Fallback to Vite's build-time environment variables
  // Note: import.meta.env keys are usually statically replaced by Vite.
  // Using bracket notation might not always work as expected for all build-time env vars,
  // but it's a common pattern for runtime config fallbacks.
  return (import.meta.env[key] as string) || ""
}

export const CONFIG = {
  VITE_API_BASE: getEnv("VITE_API_BASE"),
  VITE_API_OCR_BASE: getEnv("VITE_API_OCR_BASE"),
  VITE_OPEN_AI_KEY: getEnv("VITE_OPEN_AI_KEY"),
} as const
