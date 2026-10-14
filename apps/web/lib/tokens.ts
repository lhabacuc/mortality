import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

export const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");

/** Segredo de 256 bits com prefixo identificável. */
export function newSecret(prefix: string): string {
  return `${prefix}_${randomBytes(32).toString("base64url")}`;
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// Sem 0/O, 1/I/L, etc.
const ALPHABET = "BCDFGHJKMNPQRSTVWXZ23456789";
export function newUserCode(): string {
  const c = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization");
  const m = h && /^Bearer (.+)$/i.exec(h);
  return m ? m[1] : null;
}
