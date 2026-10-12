import type { CookieOptions, Request } from "express";

/** Parses an HTTP Cookie header into key-value pairs without dependencies. */
export function parseCookies(cookieHeader?: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) return cookies;

  for (const pair of cookieHeader.split(";")) {
    const eqIdx = pair.indexOf("=");
    if (eqIdx !== -1) {
      const key = pair.substring(0, eqIdx).trim();
      const val = pair.substring(eqIdx + 1).trim();
      try {
        cookies[key] = decodeURIComponent(val);
      } catch {
        cookies[key] = val;
      }
    }
  }

  return cookies;
}

/**
 * Computes secure cookie options for the LTI session cookie.
 *
 * - httpOnly: prevents client-side scripts from reading the token.
 * - secure: required for SameSite=None, so it follows HTTPS/production.
 * - sameSite: "none" in HTTPS/production (needed for LMS iframe embedding),
 *   falling back to "lax" for plain-HTTP local development.
 * - partitioned: opt-in via COOKIE_PARTITIONED=true for CHIPS support.
 */
export function getSessionCookieOptions(req: Request): CookieOptions {
  const isHttps =
    req.secure ||
    req.headers["x-forwarded-proto"] === "https" ||
    process.env.TOOL_URL?.startsWith("https://") === true;

  const secure =
    process.env.COOKIE_SECURE !== undefined
      ? process.env.COOKIE_SECURE === "true"
      : isHttps;

  // In browsers, SameSite=None strictly requires Secure=true.
  const sameSite = secure ? "none" : "lax";

  const options: CookieOptions = {
    httpOnly: true,
    secure,
    sameSite,
    path: "/",
  };

  if (process.env.COOKIE_PARTITIONED === "true") {
    (options as Record<string, unknown>).partitioned = true;
  }

  return options;
}
