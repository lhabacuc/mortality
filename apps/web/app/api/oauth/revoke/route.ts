import { eq } from "drizzle-orm";
import { authClient } from "@/lib/client-auth";
import { withCors, preflight } from "@/lib/cors";
import { db, schema } from "@/lib/db";
import { revokeFamily } from "@/lib/oauth-tokens";
import { allow, clientIp } from "@/lib/ratelimit";
import { sha256 } from "@/lib/tokens";

/** RFC 7009: responde sempre 200 (não revela se o token existia). */
export async function POST(req: Request) {
  if (!(await allow(`revoke:${clientIp(req)}`, 60, 60))) return withCors(new Response(null, { status: 429 }));
  const form = new URLSearchParams(await req.text());
  const client = await authClient(req, form);
  if (!client) return withCors(Response.json({ error: "invalid_client" }, { status: 401 }));

  const hash = sha256(form.get("token") ?? "");
  const [rt] = await db().select().from(schema.refreshTokens).where(eq(schema.refreshTokens.tokenHash, hash)).limit(1);
  if (rt && rt.clientId === client.clientId) await revokeFamily(rt.familyId);
  const [at] = await db().select().from(schema.accessTokens).where(eq(schema.accessTokens.tokenHash, hash)).limit(1);
  if (at && at.clientId === client.clientId) {
    if (at.familyId) await revokeFamily(at.familyId);
    else await db().update(schema.accessTokens).set({ revokedAt: new Date() }).where(eq(schema.accessTokens.id, at.id));
  }
  return withCors(new Response(null, { status: 200, headers: { "cache-control": "no-store" } }));
}
export const OPTIONS = preflight;
