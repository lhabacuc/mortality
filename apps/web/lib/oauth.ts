import { createHash, timingSafeEqual } from "node:crypto";

export const SCOPE = "mcp:tools";

export const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");

export const isValidChallenge = (c: string) => /^[A-Za-z0-9_-]{43}$/.test(c);

/** RFC 7636: verifier 43–128 chars [A-Za-z0-9-._~]; comparação em tempo constante. */
export function verifyPkce(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const a = Buffer.from(s256(verifier)), b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
const BLOCKED_SCHEMES = new Set(["javascript", "data", "vbscript", "file", "about", "blob", "ftp"]);

export function validRedirectUri(uri: string): boolean {
  if (uri.length > 2000) return false;
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (u.hash || u.username || u.password) return false;
  const scheme = u.protocol.slice(0, -1);
  if (scheme === "https") return true;
  if (scheme === "http") return LOOPBACK.has(u.hostname);
  return !BLOCKED_SCHEMES.has(scheme) && /^[a-z][a-z0-9+.-]*$/.test(scheme);
}

/** Correspondência exata; exceção RFC 8252 §7.3: em loopback `http` a porta pode variar. */
export function redirectMatches(registered: string[], uri: string): boolean {
  if (registered.includes(uri)) return true;
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (u.protocol !== "http:" || !LOOPBACK.has(u.hostname)) return false;
  return registered.some((r) => {
    try {
      const x = new URL(r);
      return x.protocol === "http:" && x.hostname === u.hostname && x.pathname === u.pathname && x.search === u.search;
    } catch { return false; }
  });
}

export const canonicalResource = (base: string) => `${base.replace(/\/$/, "")}/api/mcp`;
export const normalizeResource = (r: string) => r.replace(/\/$/, "");

export function parseScope(s: string | null | undefined): string | null {
  const parts = (s ?? SCOPE).split(/\s+/).filter(Boolean);
  return parts.every((p) => p === SCOPE) ? SCOPE : null;
}

/** `next` só pode ser um caminho relativo local (evita open redirect). */
export function safeNext(n: string | null | undefined): string | null {
  return n && n.startsWith("/") && !n.startsWith("//") && !n.startsWith("/\\") ? n : null;
}
