import { z } from "zod";
import { db, schema } from "@/lib/db";
import { allow, clientIp } from "@/lib/ratelimit";
import { json } from "@/lib/relay-auth";
import { newSecret, newUserCode, sha256 } from "@/lib/tokens";
import { appUrl } from "@/lib/app-url";

const Body = z.object({
  device_name: z.string().trim().min(1).max(60).regex(/^[\w .-]+$/),
  os: z.string().trim().max(60).optional(),
});

/** RFC 8628 §3.1 — pedido de autorização do dispositivo (feito pelo `mortality install`). */
export async function POST(req: Request) {
  if (!(await allow(`device:${clientIp(req)}`, 10, 60))) return json({ error: "slow_down" }, 429);
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return json({ error: "invalid_request" }, 400);

  const deviceCode = newSecret("mdc");
  const userCode = newUserCode();
  const expiresIn = 600;
  await db().insert(schema.deviceCodes).values({
    deviceCodeHash: sha256(deviceCode), userCode,
    deviceName: body.data.device_name, os: body.data.os ?? null,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
  });
  const base = appUrl(new URL(req.url).origin);
  return json({
    device_code: deviceCode, user_code: userCode,
    verification_uri: `${base}/device`,
    verification_uri_complete: `${base}/device?code=${userCode}`,
    expires_in: expiresIn, interval: 5,
  });
}
