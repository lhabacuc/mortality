import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "./db";
import { newSecret, sha256 } from "./tokens";

const REFRESH_TTL_S = 30 * 24 * 3600;
export const accessTtl = () => (Number(process.env.ACCESS_TOKEN_TTL) > 0 ? Number(process.env.ACCESS_TOKEN_TTL) : 3600);

export async function issueTokens(p: {
  userId: string; clientId: string; resource: string; scope: string; familyId?: string;
}) {
  const family = p.familyId ?? randomUUID();
  const access = newSecret("mat");
  const refresh = newSecret("mrt");
  const ttl = accessTtl();
  await db().insert(schema.accessTokens).values({
    tokenHash: sha256(access), userId: p.userId, clientId: p.clientId, kind: "oauth",
    scope: p.scope, resource: p.resource, familyId: family, expiresAt: new Date(Date.now() + ttl * 1000),
  });
  await db().insert(schema.refreshTokens).values({
    tokenHash: sha256(refresh), userId: p.userId, clientId: p.clientId, familyId: family,
    expiresAt: new Date(Date.now() + REFRESH_TTL_S * 1000),
  });
  return { access_token: access, token_type: "Bearer", expires_in: ttl, refresh_token: refresh, scope: p.scope };
}

/** Revoga a família inteira (refresh + access tokens): reutilização ou revogação explícita. */
export async function revokeFamily(familyId: string) {
  const now = new Date();
  await db().update(schema.refreshTokens).set({ revokedAt: now })
    .where(and(eq(schema.refreshTokens.familyId, familyId), isNull(schema.refreshTokens.revokedAt)));
  await db().update(schema.accessTokens).set({ revokedAt: now })
    .where(and(eq(schema.accessTokens.familyId, familyId), isNull(schema.accessTokens.revokedAt)));
}

/** Revoga tudo o que um cliente OAuth tem para um utilizador (tokens e grants). */
export async function revokeClientForUser(userId: string, clientId: string) {
  const now = new Date();
  await db().update(schema.refreshTokens).set({ revokedAt: now })
    .where(and(eq(schema.refreshTokens.userId, userId), eq(schema.refreshTokens.clientId, clientId), isNull(schema.refreshTokens.revokedAt)));
  await db().update(schema.accessTokens).set({ revokedAt: now })
    .where(and(eq(schema.accessTokens.userId, userId), eq(schema.accessTokens.clientId, clientId), isNull(schema.accessTokens.revokedAt)));
  await db().update(schema.clientGrants).set({ revokedAt: now })
    .where(and(eq(schema.clientGrants.userId, userId), eq(schema.clientGrants.clientId, clientId), isNull(schema.clientGrants.revokedAt)));
}
