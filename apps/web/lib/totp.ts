import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, randomInt } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const b of buf) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of s.replace(/[\s=-]/g, "").toUpperCase()) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error("base32 inválido");
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** RFC 4226 (HMAC-SHA1, truncagem dinâmica). */
export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", secret).update(msg).digest();
  const o = h[h.length - 1] & 0x0f;
  const n = ((h[o] & 0x7f) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 10 ** digits).padStart(digits, "0");
}

export const stepOf = (nowMs: number, period = 30) => Math.floor(nowMs / 1000 / period);
export const totp = (secret: Buffer, nowMs = Date.now(), digits = 6) => hotp(secret, stepOf(nowMs), digits);

/**
 * Devolve o step aceite (para guardar e impedir replay) ou null.
 * Janela ±1 step; só aceita steps > lastStep.
 */
export function verifyTotp(secret: Buffer, code: string, nowMs = Date.now(), lastStep: number | null = null, window = 1): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const cur = stepOf(nowMs);
  let hit: number | null = null;
  for (let d = -window; d <= window; d++) {
    const step = cur + d;
    if (lastStep !== null && step <= lastStep) continue;
    if (hotp(secret, step) === code) hit = step; // sem early-return: tempo ~constante
  }
  return hit;
}

export const newTotpSecret = () => randomBytes(20);

export function otpauthUrl(issuer: string, account: string, secretB32: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

// ── Cifra em repouso ────────────────────────────────────────────────────────
function key(): Buffer {
  const s = process.env.TOTP_ENC_KEY || process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("TOTP_ENC_KEY/SESSION_SECRET (>=32) em falta");
  return Buffer.from(hkdfSync("sha256", s, "mortality", "totp-secret-v1", 32));
}

export function encryptSecret(plain: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), ct.toString("base64")].join(".");
}

export function decryptSecret(enc: string): Buffer {
  const [v, iv, tag, ct] = enc.split(".");
  if (v !== "v1") throw new Error("formato desconhecido");
  const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]);
}

const RC = "BCDFGHJKMNPQRSTVWXZ23456789";
export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const c = Array.from({ length: 10 }, () => RC[randomInt(RC.length)]).join("");
    return `${c.slice(0, 5)}-${c.slice(5)}`;
  });
}
