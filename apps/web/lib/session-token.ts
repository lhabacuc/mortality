import { createHmac, timingSafeEqual } from "node:crypto";

export const TTL_MS = 7 * 24 * 3600 * 1000;

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET tem de ter >= 32 caracteres");
  return s;
}
const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

export function encodeSession(userId: string, now = Date.now()): string {
  const payload = `${userId}.${now + TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

export function decodeSession(value: string, now = Date.now()): string | null {
  const i = value.lastIndexOf(".");
  if (i < 0) return null;
  const payload = value.slice(0, i), mac = value.slice(i + 1);
  const a = Buffer.from(mac), b = Buffer.from(sign(payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [userId, exp] = payload.split(".");
  return userId && Number(exp) > now ? userId : null;
}

