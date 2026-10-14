"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ALL_TOOLS, checkCeiling } from "@mortality/shared";
import { audit } from "./audit";
import { db, schema } from "./db";
import { requireUser } from "./guard";
import type { PanelState } from "./panel-actions";
import { revokeClientForUser } from "./oauth-tokens";

const DURATIONS: Record<string, number | null> = { "1h": 3600, "24h": 86400, "30d": 2592000, never: null };
const lines = (v: FormDataEntryValue | null) =>
  String(v ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 50);

const GrantFields = z.object({
  preset: z.enum(["read_only", "read_write", "terminal", "custom"]),
  duration: z.enum(["keep", "1h", "24h", "30d", "never"]),
});

function parseGrant(form: FormData) {
  const base = GrantFields.safeParse(Object.fromEntries(form));
  if (!base.success) return { error: "Dados inválidos." } as const;
  const dirs = lines(form.get("dirs"));
  if (!dirs.length || dirs.some((d) => d.length > 1024 || !/^([/~]|[a-zA-Z]:[\\/])/.test(d))) {
    return { error: "Indica pelo menos um diretório absoluto permitido (um por linha)." } as const;
  }
  const tools = form.getAll("tools").map(String).filter((t) => ALL_TOOLS.includes(t));
  if (base.data.preset === "custom" && !tools.length) return { error: "Escolhe pelo menos uma tool." } as const;
  return {
    value: {
      preset: base.data.preset, duration: base.data.duration, allowedDirs: dirs,
      blockedCommands: lines(form.get("blocked")).map((b) => b.slice(0, 100)),
      readOnly: form.get("readOnly") === "on",
      allowedTools: base.data.preset === "custom" ? tools : [],
      requireApprovalFor: form.getAll("approve").map(String).filter((t) => ALL_TOOLS.includes(t)),
    },
  } as const;
}

const expiry = (d: string) => (d === "keep" ? undefined : DURATIONS[d] ? new Date(Date.now() + DURATIONS[d]! * 1000) : null);

export async function updateGrant(_: PanelState, form: FormData): Promise<PanelState> {
  const user = await requireUser();
  const id = z.string().uuid().safeParse(form.get("grantId"));
  if (!id.success) return { error: "Grant inválido." };
  const g = parseGrant(form);
  if ("error" in g) return { error: g.error };
  const over = checkCeiling(user, { preset: g.value.preset, tools: g.value.allowedTools });
  if (over) return { error: over };
  const exp = expiry(g.value.duration);
  const res = await db().update(schema.clientGrants).set({
    preset: g.value.preset, allowedDirs: g.value.allowedDirs, blockedCommands: g.value.blockedCommands,
    readOnly: g.value.readOnly, allowedTools: g.value.allowedTools, requireApprovalFor: g.value.requireApprovalFor,
    ...(exp === undefined ? {} : { expiresAt: exp }),
  }).where(and(eq(schema.clientGrants.id, id.data), eq(schema.clientGrants.userId, user.id), isNull(schema.clientGrants.revokedAt)))
    .returning({ deviceId: schema.clientGrants.deviceId, clientId: schema.clientGrants.clientId });
  if (!res.length) return { error: "Grant não encontrado." };
  await audit({ userId: user.id, deviceId: res[0].deviceId, clientId: res[0].clientId, actor: "user", action: "grant.update", argsSummary: g.value.preset });
  revalidatePath("/clients");
  return { ok: "Guardado." };
}

export async function addGrant(_: PanelState, form: FormData): Promise<PanelState> {
  const user = await requireUser();
  const ids = z.object({ clientId: z.string().min(1).max(100), deviceId: z.string().uuid() }).safeParse(Object.fromEntries(form));
  if (!ids.success) return { error: "Dados inválidos." };
  const g = parseGrant(form);
  if ("error" in g) return { error: g.error };
  const over = checkCeiling(user, { preset: g.value.preset, tools: g.value.allowedTools });
  if (over) return { error: over };

  // O cliente tem de ser um PAT do utilizador ou um cliente OAuth ao qual ele já deu acesso.
  const isUuid = z.string().uuid().safeParse(ids.data.clientId).success;
  const [pat] = isUuid
    ? await db().select({ id: schema.accessTokens.id }).from(schema.accessTokens).where(and(
        eq(schema.accessTokens.id, ids.data.clientId), eq(schema.accessTokens.userId, user.id),
        eq(schema.accessTokens.kind, "pat"), isNull(schema.accessTokens.revokedAt))).limit(1)
    : [];
  const [known] = pat ? [pat] : await db().select({ id: schema.clientGrants.id }).from(schema.clientGrants).where(and(
    eq(schema.clientGrants.userId, user.id), eq(schema.clientGrants.clientId, ids.data.clientId))).limit(1);
  const tok = known ? { id: ids.data.clientId } : undefined;
  const [dev] = await db().select({ id: schema.devices.id }).from(schema.devices)
    .where(and(eq(schema.devices.id, ids.data.deviceId), eq(schema.devices.userId, user.id), isNull(schema.devices.revokedAt))).limit(1);
  if (!tok || !dev) return { error: "Cliente ou dispositivo inválido." };

  const exp = expiry(g.value.duration);
  const inserted = await db().insert(schema.clientGrants).values({
    userId: user.id, clientId: tok.id, deviceId: dev.id, preset: g.value.preset,
    allowedDirs: g.value.allowedDirs, blockedCommands: g.value.blockedCommands, readOnly: g.value.readOnly,
    allowedTools: g.value.allowedTools, requireApprovalFor: g.value.requireApprovalFor, expiresAt: exp ?? null,
  }).onConflictDoNothing().returning({ id: schema.clientGrants.id });
  if (!inserted.length) return { error: "Este cliente já tem acesso a esse dispositivo." };
  await audit({ userId: user.id, deviceId: dev.id, clientId: tok.id, actor: "user", action: "grant.create", argsSummary: g.value.preset });
  revalidatePath("/clients");
  return { ok: "Acesso concedido." };
}

export async function revokeGrant(form: FormData) {
  const user = await requireUser();
  const id = z.string().uuid().parse(form.get("grantId"));
  const res = await db().update(schema.clientGrants).set({ revokedAt: new Date() })
    .where(and(eq(schema.clientGrants.id, id), eq(schema.clientGrants.userId, user.id), isNull(schema.clientGrants.revokedAt)))
    .returning({ deviceId: schema.clientGrants.deviceId, clientId: schema.clientGrants.clientId });
  if (res.length) await audit({ userId: user.id, deviceId: res[0].deviceId, clientId: res[0].clientId, actor: "user", action: "grant.revoke" });
  revalidatePath("/clients");
}

/** Kill-switch global do utilizador: revoga grants, tokens de acesso e refresh tokens. */
export async function disconnectAll() {
  const user = await requireUser();
  const now = new Date();
  await db().update(schema.clientGrants).set({ revokedAt: now })
    .where(and(eq(schema.clientGrants.userId, user.id), isNull(schema.clientGrants.revokedAt)));
  await db().update(schema.accessTokens).set({ revokedAt: now })
    .where(and(eq(schema.accessTokens.userId, user.id), isNull(schema.accessTokens.revokedAt)));
  await db().update(schema.refreshTokens).set({ revokedAt: now })
    .where(and(eq(schema.refreshTokens.userId, user.id), isNull(schema.refreshTokens.revokedAt)));
  await audit({ userId: user.id, actor: "user", action: "disconnect_all" });
  revalidatePath("/clients");
  revalidatePath("/activity");
  revalidatePath("/tokens");
}

export async function revokeOAuthClient(form: FormData) {
  const user = await requireUser();
  const clientId = z.string().min(1).max(100).parse(form.get("clientId"));
  await revokeClientForUser(user.id, clientId);
  await audit({ userId: user.id, clientId, actor: "user", action: "oauth_client.revoke" });
  revalidatePath("/clients");
}
