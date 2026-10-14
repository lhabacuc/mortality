"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { checkCeiling } from "@mortality/shared";
import { count } from "drizzle-orm";
import { db, schema } from "./db";
import { requireUser } from "./guard";
import { allow } from "./ratelimit";
import { audit } from "./audit";
import { newSecret, sha256 } from "./tokens";

export type PanelState = { error?: string; token?: string; ok?: string } | undefined;

const Code = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);

export async function resolveDeviceCode(_: PanelState, form: FormData): Promise<PanelState> {
  const user = await requireUser();
  if (!(await allow(`usercode:${user.id}`, 10, 600))) return { error: "Demasiadas tentativas. Tenta mais tarde." };
  const code = Code.safeParse(form.get("code"));
  if (!code.success) return { error: "Código inválido." };
  redirect(`/device?code=${code.data}`);
}

export async function decideDevice(form: FormData) {
  const user = await requireUser();
  const code = Code.parse(form.get("code"));
  const name = z.string().trim().min(1).max(60).regex(/^[\w .-]+$/).parse(form.get("name"));
  const approve = form.get("decision") === "approve";

  const [dc] = await db().select().from(schema.deviceCodes).where(eq(schema.deviceCodes.userCode, code)).limit(1);
  if (!dc || dc.status !== "pending" || dc.expiresAt < new Date()) redirect("/device?error=expired");

  if (approve) {
    const [{ n }] = await db().select({ n: count() }).from(schema.devices)
      .where(and(eq(schema.devices.userId, user.id), isNull(schema.devices.revokedAt)));
    if (n >= user.maxDevices) redirect(`/device?code=${code}&error=limit`);
    const [clash] = await db().select({ id: schema.devices.id }).from(schema.devices)
      .where(and(eq(schema.devices.userId, user.id), eq(schema.devices.name, name), isNull(schema.devices.revokedAt))).limit(1);
    if (clash) redirect(`/device?code=${code}&error=name`);
  }
  await db().update(schema.deviceCodes).set({
    status: approve ? "approved" : "denied", userId: user.id, deviceName: name,
  }).where(and(eq(schema.deviceCodes.userCode, code), eq(schema.deviceCodes.status, "pending")));
  await audit({ userId: user.id, actor: "user", action: approve ? "device.pair" : "device.pair_denied", argsSummary: name });
  redirect("/devices");
}

const DeviceOp = z.object({ deviceId: z.string().uuid(), op: z.enum(["enable", "disable", "revoke"]) });

export async function deviceAction(form: FormData) {
  const user = await requireUser();
  const { deviceId, op } = DeviceOp.parse(Object.fromEntries(form));
  const own = and(eq(schema.devices.id, deviceId), eq(schema.devices.userId, user.id));
  if (op === "revoke") {
    const now = new Date();
    await db().update(schema.devices).set({ revokedAt: now, enabled: false }).where(own);
    await db().update(schema.deviceTokens).set({ revokedAt: now }).where(eq(schema.deviceTokens.deviceId, deviceId));
    await db().update(schema.clientGrants).set({ revokedAt: now })
      .where(and(eq(schema.clientGrants.deviceId, deviceId), eq(schema.clientGrants.userId, user.id)));
  } else {
    await db().update(schema.devices).set({ enabled: op === "enable" }).where(own);
  }
  await audit({ userId: user.id, deviceId, actor: "user", action: `device.${op}` });
  revalidatePath("/devices");
}

const DURATIONS: Record<string, number | null> = { "1h": 3600, "24h": 86400, "30d": 2592000, never: null };

const CreatePat = z.object({
  name: z.string().trim().min(1).max(60),
  deviceId: z.string().uuid(),
  preset: z.enum(["read_only", "read_write", "terminal"]),
  duration: z.enum(["1h", "24h", "30d", "never"]),
  dirs: z.string().max(4000),
});

/** PAT nasce sem acesso: o grant (cliente × dispositivo) é criado no mesmo passo. */
export async function createPat(_: PanelState, form: FormData): Promise<PanelState> {
  const user = await requireUser();
  const p = CreatePat.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Preenche todos os campos." };
  const dirs = p.data.dirs.split("\n").map((d) => d.trim()).filter(Boolean);
  if (!dirs.length || dirs.some((d) => !/^([/~]|[a-zA-Z]:[\\/])/.test(d))) {
    return { error: "Indica pelo menos um diretório absoluto permitido (um por linha)." };
  }
  const over = checkCeiling(user, { preset: p.data.preset });
  if (over) return { error: over };
  const [device] = await db().select({ id: schema.devices.id }).from(schema.devices)
    .where(and(eq(schema.devices.id, p.data.deviceId), eq(schema.devices.userId, user.id), isNull(schema.devices.revokedAt))).limit(1);
  if (!device) return { error: "Dispositivo inválido." };

  const secret = newSecret("mpat");
  const ttl = DURATIONS[p.data.duration];
  const expiresAt = ttl ? new Date(Date.now() + ttl * 1000) : null;
  const [tok] = await db().insert(schema.accessTokens).values({
    tokenHash: sha256(secret), userId: user.id, kind: "pat", name: p.data.name, scope: "mcp:tools", expiresAt,
  }).returning({ id: schema.accessTokens.id });
  await db().insert(schema.clientGrants).values({
    userId: user.id, clientId: tok.id, deviceId: device.id, preset: p.data.preset,
    allowedDirs: dirs, requireApprovalFor: p.data.preset === "terminal" ? ["start_process"] : [], expiresAt,
  });
  await audit({ userId: user.id, deviceId: device.id, clientId: tok.id, actor: "user", action: "pat.create", argsSummary: `${p.data.name} ${p.data.preset}` });
  revalidatePath("/tokens");
  return { token: secret };
}

export async function revokePat(form: FormData) {
  const user = await requireUser();
  const id = z.string().uuid().parse(form.get("id"));
  const now = new Date();
  await db().update(schema.accessTokens).set({ revokedAt: now })
    .where(and(eq(schema.accessTokens.id, id), eq(schema.accessTokens.userId, user.id)));
  await db().update(schema.clientGrants).set({ revokedAt: now })
    .where(and(eq(schema.clientGrants.clientId, id), eq(schema.clientGrants.userId, user.id)));
  await audit({ userId: user.id, clientId: id, actor: "user", action: "pat.revoke" });
  revalidatePath("/tokens");
}
