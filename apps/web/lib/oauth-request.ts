import { eq } from "drizzle-orm";
import { audit } from "./audit";
import { db, schema } from "./db";
import { sha256 } from "./tokens";
import { canonicalResource, isValidChallenge, normalizeResource, parseScope, redirectMatches } from "./oauth";

export type AuthRequest =
  | { kind: "fatal"; message: string }
  | { kind: "redirect_error"; redirectUri: string; error: string; state: string | null }
  | {
      kind: "ok"; clientId: string; clientName: string; redirectUri: string; state: string | null;
      challenge: string; resource: string; scope: string;
    };

/** Valida um pedido de autorização (usado pela página de consentimento e pela action). */
export async function validateAuthRequest(get: (k: string) => string | null, base: string): Promise<AuthRequest> {
  const clientId = get("client_id") ?? "";
  const redirectUri = get("redirect_uri") ?? "";
  const [client] = clientId
    ? await db().select().from(schema.oauthClients).where(eq(schema.oauthClients.clientId, clientId)).limit(1)
    : [];
  // Sem cliente/redirect válidos nunca se redireciona (evita open redirect).
  if (!client) {
    // Um token de acesso colado no campo «Client ID»: ficou exposto no URL → revogar já.
    if (clientId.startsWith("mpat_")) {
      const [t] = await db().select({ id: schema.accessTokens.id, userId: schema.accessTokens.userId })
        .from(schema.accessTokens).where(eq(schema.accessTokens.tokenHash, sha256(clientId))).limit(1);
      if (t) {
        const now = new Date();
        await db().update(schema.accessTokens).set({ revokedAt: now }).where(eq(schema.accessTokens.id, t.id));
        await db().update(schema.clientGrants).set({ revokedAt: now }).where(eq(schema.clientGrants.clientId, t.id));
        await audit({ userId: t.userId, actor: "system", action: "pat.revoke", argsSummary: "token exposto como client_id" });
      }
      return { kind: "fatal", message: "O que colaste em «Client ID» é um token de acesso (mpat_…). Por segurança foi revogado, porque apareceu num URL. Cria um cliente OAuth em Clientes → «Registar cliente OAuth» e usa o Client ID e o Secret gerados." };
    }
    return { kind: "fatal", message: "Cliente desconhecido. Se a aplicação pede Client ID e Secret, cria um cliente em Clientes → «Registar cliente OAuth»." };
  }
  if (!redirectMatches(client.redirectUris, redirectUri)) return { kind: "fatal", message: "redirect_uri não registado para este cliente." };

  const state = get("state");
  const fail = (error: string): AuthRequest => ({ kind: "redirect_error", redirectUri, error, state });
  if (get("response_type") !== "code") return fail("unsupported_response_type");
  const challenge = get("code_challenge") ?? "";
  if (get("code_challenge_method") !== "S256" || !isValidChallenge(challenge)) return fail("invalid_request");
  const scope = parseScope(get("scope"));
  if (!scope) return fail("invalid_scope");
  const canonical = canonicalResource(base);
  const asked = get("resource");
  if (asked && normalizeResource(asked) !== canonical) return fail("invalid_target");

  return { kind: "ok", clientId, clientName: client.name, redirectUri, state, challenge, resource: canonical, scope };
}

export function redirectWith(uri: string, params: Record<string, string | null>, issuer: string): string {
  const u = new URL(uri);
  for (const [k, v] of Object.entries(params)) if (v !== null) u.searchParams.set(k, v);
  u.searchParams.set("iss", issuer);
  return u.toString();
}
