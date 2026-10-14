import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { allow, clientIp } from "@/lib/ratelimit";
import { json } from "@/lib/relay-auth";
import { newSecret, sha256 } from "@/lib/tokens";

const Body = z.object({ device_code: z.string().min(10).max(200) });

/** RFC 8628 §3.4 — o relay faz poll até o utilizador aprovar no painel. */
export async function POST(req: Request) {
  if (!(await allow(`device-token:${clientIp(req)}`, 60, 60))) return json({ error: "slow_down" }, 400);
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: "invalid_request" }, 400);
  const hash = sha256(body.data.device_code);

  const [dc] = await db().select().from(schema.deviceCodes).where(eq(schema.deviceCodes.deviceCodeHash, hash)).limit(1);
  if (!dc || dc.status === "used" || dc.expiresAt < new Date()) return json({ error: "expired_token" }, 400);
  if (dc.status === "denied") return json({ error: "access_denied" }, 400);
  if (dc.status !== "approved" || !dc.userId) return json({ error: "authorization_pending" }, 400);

  // Só um pedido consegue trocar o código (uso único).
  const claimed = await db().update(schema.deviceCodes).set({ status: "used" })
    .where(and(eq(schema.deviceCodes.deviceCodeHash, hash), eq(schema.deviceCodes.status, "approved")))
    .returning({ id: schema.deviceCodes.userCode });
  if (!claimed.length) return json({ error: "expired_token" }, 400);

  // Liberta o nome de dispositivos revogados (UNIQUE user_id+name).
  await db().update(schema.devices).set({ name: sql`${schema.devices.name} || '~' || ${schema.devices.id}` })
    .where(and(eq(schema.devices.userId, dc.userId), eq(schema.devices.name, dc.deviceName ?? "dispositivo"),
      isNotNull(schema.devices.revokedAt)));

  const [device] = await db().insert(schema.devices).values({
    userId: dc.userId, name: dc.deviceName ?? "dispositivo", os: dc.os,
  }).returning({ id: schema.devices.id, name: schema.devices.name });

  const token = newSecret("mdt");
  await db().insert(schema.deviceTokens).values({ deviceId: device.id, tokenHash: sha256(token) });
  return json({ device_token: token, device_id: device.id, device_name: device.name });
}
