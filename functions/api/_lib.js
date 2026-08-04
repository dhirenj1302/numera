// functions/api/_lib.js
// Shared helpers for Numera's Cloudflare Pages Functions.
// Cloudflare Pages does not route requests to files whose name starts with
// an underscore, so this module is import-only and never served as an endpoint.

/**
 * Build a JSON Response with no-store caching applied by default.
 * Every API endpoint returns machine-readable JSON that should never be cached
 * by the browser or an intermediary, so this is centralised here.
 */
export const json = (body, init = {}) =>
  Response.json(body, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init.headers || {}) }
  });

/** Trim and lowercase a value for case-insensitive username comparisons. */
export const clean = value => String(value || "").trim().toLowerCase();

/** SHA-256 hex digest of a string, using the Web Crypto API available in Workers. */
export async function digest(value) {
  const buffer = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(buffer)]
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Hash a PIN together with its per-account salt.
 * The salt is stored alongside the hash so the same PIN produces a different
 * hash for every account.
 */
export async function hashPin(pin, salt) {
  return digest(`${salt}:${pin}`);
}

/** Generate an opaque session token. Two UUIDs give ample entropy. */
export async function sessionToken() {
  return crypto.randomUUID() + crypto.randomUUID();
}

/**
 * Return the setter row for a valid, unexpired session, or null.
 * Shared by every endpoint that must confirm a teacher is signed in.
 */
export async function validSetter(db, username, token) {
  return db
    .prepare(
      "SELECT username,display_name FROM setters WHERE username=? AND session_token=? AND session_expires>CURRENT_TIMESTAMP"
    )
    .bind(clean(username), token)
    .first();
}
