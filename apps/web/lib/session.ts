import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { TTL_MS, decodeSession, encodeSession } from "./session-token";

const COOKIE = "mortality_session";

export async function startSession(userId: string) {
  (await cookies()).set(COOKIE, encodeSession(userId), {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", path: "/", maxAge: TTL_MS / 1000,
  });
}

export async function endSession() {
  (await cookies()).delete(COOKIE);
}

/** Utilizador da sessão; o estado é lido da BD a cada pedido (suspensão tem efeito imediato). */
export async function currentUser() {
  const raw = (await cookies()).get(COOKIE)?.value;
  const userId = raw && decodeSession(raw);
  if (!userId) return null;
  const [user] = await db().select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  return user && user.status !== "suspended" ? user : null;
}
