import { and, eq, isNull } from "drizzle-orm";
import { jsonCors, preflight, baseUrl } from "@/lib/cors";
import { authClient } from "@/lib/client-auth";
import { db, schema } from "@/lib/db";
import { canonicalResource, normalizeResource, verifyPkce } from "@/lib/oauth";
import { issueTokens, revokeClientForUser, revokeFamily } from "@/lib/oauth-tokens";
import { allow, clientIp } from "@/lib/ratelimit";
import { sha256 } from "@/lib/tokens";

const err = (error: string, description?: string, status = 400) =>
  jsonCors({ error, ...(description ? { error_description: description } : {}) }, status);

export async function POST(req: Request) {
  if (!(await allow(`token:${clientIp(req)}`, 60, 60))) return err("slow_down", "Demasiados pedidos.", 429);
  const form = new URLSearchParams(await req.text());
  const client = await authClient(req, form);
  if (!client) return err("invalid_client", undefined, 401);

  const grant = form.get("grant_type");
  const resource = canonicalResource(baseUrl(req));
  const askedResource = form.get("resource");
  if (askedResource && normalizeResource(askedResource) !== resource) return err("invalid_target");

  if (grant === "authorization_code") {
    const code = form.get("code") ?? "", verifier = form.get("code_verifier") ?? "";
    const [row] = await db().select().from(schema.authCodes).where(eq(schema.authCodes.codeHash, sha256(code))).limit(1);
    if (!row || row.clientId !== client.clientId) return err("invalid_grant");
    if (row.usedAt) {
      // Reutilização de código: revoga o que foi emitido a este cliente para este utilizador.
      await revokeClientForUser(row.userId, row.clientId);
      return err("invalid_grant", "Código já utilizado.");
    }
    if (row.expiresAt < new Date()) return err("invalid_grant", "Código expirado.");
    // RFC 6749 §4.1.3: tem de ser idêntico ao usado no pedido de autorização.
    if (form.get("redirect_uri") !== row.redirectUri) return err("invalid_grant", "redirect_uri não coincide.");
    if (!verifyPkce(verifier, row.codeChallenge)) return err("invalid_grant", "PKCE inválido.");
    if (askedResource && row.resource && normalizeResource(askedResource) !== row.resource) return err("invalid_target");

    const claimed = await db().update(schema.authCodes).set({ usedAt: new Date() })
      .where(and(eq(schema.authCodes.codeHash, row.codeHash), isNull(schema.authCodes.usedAt)))
      .returning({ h: schema.authCodes.codeHash });
    if (!claimed.length) return err("invalid_grant", "Código já utilizado.");

    const [user] = await db().select({ s: schema.users.status }).from(schema.users).where(eq(schema.users.id, row.userId)).limit(1);
    if (user?.s !== "active") return err("invalid_grant");
    return jsonCors(await issueTokens({ userId: row.userId, clientId: row.clientId, resource: row.resource ?? resource, scope: row.scope }));
  }

  if (grant === "refresh_token") {
    const [rt] = await db().select().from(schema.refreshTokens)
      .where(eq(schema.refreshTokens.tokenHash, sha256(form.get("refresh_token") ?? ""))).limit(1);
    if (!rt || rt.clientId !== client.clientId || rt.revokedAt || rt.expiresAt < new Date()) return err("invalid_grant");
    if (rt.usedAt) { await revokeFamily(rt.familyId); return err("invalid_grant", "Refresh token reutilizado: sessão revogada."); }

    const claimed = await db().update(schema.refreshTokens).set({ usedAt: new Date() })
      .where(and(eq(schema.refreshTokens.id, rt.id), isNull(schema.refreshTokens.usedAt)))
      .returning({ id: schema.refreshTokens.id });
    if (!claimed.length) { await revokeFamily(rt.familyId); return err("invalid_grant", "Refresh token reutilizado: sessão revogada."); }

    const [user] = await db().select({ s: schema.users.status }).from(schema.users).where(eq(schema.users.id, rt.userId)).limit(1);
    if (user?.s !== "active") { await revokeFamily(rt.familyId); return err("invalid_grant"); }
    return jsonCors(await issueTokens({ userId: rt.userId, clientId: rt.clientId, resource, scope: "mcp:tools", familyId: rt.familyId }));
  }

  return err("unsupported_grant_type");
}
export const OPTIONS = preflight;
