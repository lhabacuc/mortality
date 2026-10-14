"use server";

import { randomBytes } from "node:crypto";
import { and, count, eq, isNull, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ALL_TOOLS } from "@mortality/shared";
import { audit } from "./audit";
import { db, schema } from "./db";
import { requireAdmin } from "./guard";
import type { PanelState } from "./panel-actions";
import { sha256 } from "./tokens";

const Uuid = z.string().uuid();

async function otherActiveAdmins(exceptId: string) {
  const [{ n }] = await db().select({ n: count() }).from(schema.users)
    .where(and(eq(schema.users.role, "admin"), eq(schema.users.status, "active"), ne(schema.users.id, exceptId)));
  return n;
}

export async function setRole(form: FormData) {
  const admin = await requireAdmin();
  const userId = Uuid.parse(form.get("userId"));
  const role = z.enum(["admin", "user"]).parse(form.get("role"));
  if (userId === admin.id) return; // nunca sobre si próprio: não se pode ficar sem admin
  const [target] = await db().select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!target || target.role === role) return;
  if (role === "admin" && target.status !== "active") return;
  // Despromover só se sobrar outro admin ativo: nunca ficamos sem administrador.
  if (role === "user" && (await otherActiveAdmins(userId)) < 1) return;
  await db().update(schema.users).set({ role }).where(eq(schema.users.id, userId));
  await audit({ userId, actor: "admin", action: `admin.role.${role}`, argsSummary: `by ${admin.email}` });
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin");
}

export async function setLimits(_: PanelState, form: FormData): Promise<PanelState> {
  const admin = await requireAdmin();
  const p = z.object({
    userId: Uuid,
    maxPreset: z.enum(["read_only", "read_write", "terminal"]),
    maxDevices: z.coerce.number().int().min(0).max(100),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Valores inválidos." };
  const disabled = form.getAll("disabled").map(String).filter((t) => ALL_TOOLS.includes(t));
  await db().update(schema.users).set({
    maxPreset: p.data.maxPreset, maxDevices: p.data.maxDevices, disabledTools: disabled,
  }).where(eq(schema.users.id, p.data.userId));
  await audit({ userId: p.data.userId, actor: "admin", action: "admin.limits", argsSummary: `${p.data.maxPreset} dev<=${p.data.maxDevices} off=${disabled.length} by ${admin.email}` });
  revalidatePath(`/admin/users/${p.data.userId}`);
  return { ok: "Limites guardados (aplicam-se já aos acessos existentes)." };
}

export async function revokeAllForUser(form: FormData) {
  const admin = await requireAdmin();
  const userId = Uuid.parse(form.get("userId"));
  const now = new Date();
  await db().update(schema.clientGrants).set({ revokedAt: now }).where(and(eq(schema.clientGrants.userId, userId), isNull(schema.clientGrants.revokedAt)));
  await db().update(schema.accessTokens).set({ revokedAt: now }).where(and(eq(schema.accessTokens.userId, userId), isNull(schema.accessTokens.revokedAt)));
  await db().update(schema.refreshTokens).set({ revokedAt: now }).where(and(eq(schema.refreshTokens.userId, userId), isNull(schema.refreshTokens.revokedAt)));
  await audit({ userId, actor: "admin", action: "admin.revoke_all", argsSummary: `by ${admin.email}` });
  revalidatePath(`/admin/users/${userId}`);
}

export async function adminRevoke(form: FormData) {
  const admin = await requireAdmin();
  const kind = z.enum(["device", "grant", "token"]).parse(form.get("kind"));
  const id = Uuid.parse(form.get("id"));
  const userId = Uuid.parse(form.get("userId"));
  const now = new Date();
  if (kind === "device") {
    await db().update(schema.devices).set({ revokedAt: now, enabled: false }).where(and(eq(schema.devices.id, id), eq(schema.devices.userId, userId)));
    await db().update(schema.deviceTokens).set({ revokedAt: now }).where(eq(schema.deviceTokens.deviceId, id));
    await db().update(schema.clientGrants).set({ revokedAt: now }).where(and(eq(schema.clientGrants.deviceId, id), isNull(schema.clientGrants.revokedAt)));
  } else if (kind === "grant") {
    await db().update(schema.clientGrants).set({ revokedAt: now }).where(and(eq(schema.clientGrants.id, id), eq(schema.clientGrants.userId, userId)));
  } else {
    await db().update(schema.accessTokens).set({ revokedAt: now }).where(and(eq(schema.accessTokens.id, id), eq(schema.accessTokens.userId, userId)));
    await db().update(schema.clientGrants).set({ revokedAt: now }).where(and(eq(schema.clientGrants.clientId, id.toString()), eq(schema.clientGrants.userId, userId)));
  }
  await audit({ userId, actor: "admin", action: `admin.revoke.${kind}`, argsSummary: `${id} by ${admin.email}` });
  revalidatePath(`/admin/users/${userId}`);
}

export async function deleteUser(form: FormData) {
  const admin = await requireAdmin();
  const userId = Uuid.parse(form.get("userId"));
  if (userId === admin.id) return;
  const res = await db().delete(schema.users).where(and(eq(schema.users.id, userId), ne(schema.users.role, "admin"))).returning({ id: schema.users.id });
  if (res.length) await audit({ actor: "admin", action: "admin.user.delete", argsSummary: `${userId} by ${admin.email}` });
  revalidatePath("/admin");
}

export async function createInvite(_: PanelState, form: FormData): Promise<PanelState> {
  const admin = await requireAdmin();
  const p = z.object({
    email: z.string().trim().toLowerCase().email().max(254).or(z.literal("")),
    days: z.coerce.number().int().min(1).max(30),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) return { error: "Dados inválidos." };
  const raw = `minv_${randomBytes(24).toString("base64url")}`;
  await db().insert(schema.invites).values({
    tokenHash: sha256(raw), email: p.data.email || null, createdBy: admin.id,
    expiresAt: new Date(Date.now() + p.data.days * 86_400_000),
  });
  await audit({ actor: "admin", action: "admin.invite.create", argsSummary: `${p.data.email || "qualquer email"} by ${admin.email}` });
  revalidatePath("/admin/invites");
  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return { token: `${base}/signup?invite=${raw}` };
}

export async function revokeInvite(form: FormData) {
  await requireAdmin();
  const id = Uuid.parse(form.get("id"));
  await db().delete(schema.invites).where(and(eq(schema.invites.id, id), isNull(schema.invites.usedAt)));
  revalidatePath("/admin/invites");
}
