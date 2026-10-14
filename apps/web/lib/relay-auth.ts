import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "./db";
import { bearer, sha256 } from "./tokens";

/** Autentica um pedido do relay pelo device token. Só serve /api/relay/*. */
export async function authRelay(req: Request) {
  const token = bearer(req);
  if (!token?.startsWith("mdt_")) return null;
  const [row] = await db().select({ device: schema.devices, user: schema.users, tokenId: schema.deviceTokens.id })
    .from(schema.deviceTokens)
    .innerJoin(schema.devices, eq(schema.devices.id, schema.deviceTokens.deviceId))
    .innerJoin(schema.users, eq(schema.users.id, schema.devices.userId))
    .where(and(eq(schema.deviceTokens.tokenHash, sha256(token)), isNull(schema.deviceTokens.revokedAt)))
    .limit(1);
  if (!row || row.device.revokedAt || row.user.status !== "active") return null;
  return row;
}

export const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
