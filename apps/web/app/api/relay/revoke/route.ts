import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { audit } from "@/lib/audit";
import { authRelay, json } from "@/lib/relay-auth";

/** `mortality uninstall`: o dispositivo revoga-se a si próprio. */
export async function POST(req: Request) {
  const auth = await authRelay(req);
  if (!auth) return json({ error: "unauthorized" }, 401);
  const now = new Date();
  await db().update(schema.deviceTokens).set({ revokedAt: now }).where(eq(schema.deviceTokens.deviceId, auth.device.id));
  await db().update(schema.devices).set({ revokedAt: now, enabled: false }).where(eq(schema.devices.id, auth.device.id));
  await db().update(schema.clientGrants).set({ revokedAt: now }).where(eq(schema.clientGrants.deviceId, auth.device.id));
  await audit({ userId: auth.user.id, deviceId: auth.device.id, actor: "relay", action: "device.self_revoke" });
  return json({ revoked: true });
}
