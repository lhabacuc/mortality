"use server";

import { randomBytes } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { checkCeiling } from "@mortality/shared";
import { parseDirFields } from "./dirs";
import { checkSudo } from "./sudo";
import { appUrl } from "./app-url";
import { audit } from "./audit";
import { db, schema } from "./db";
import { requireUser } from "./guard";
import { validateAuthRequest, redirectWith } from "./oauth-request";
import { revokeClientForUser } from "./oauth-tokens";
import { sha256 } from "./tokens";

const DURATIONS: Record<string, number | null> = { "1h": 3600, "24h": 86400, "30d": 2592000, never: null };
const KEYS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "scope", "resource"];

async function issuer() {
  const h = await headers();
  return appUrl(`${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`);
}

export async function decideConsent(form: FormData) {
  const user = await requireUser();
  const base = await issuer();
  const req = await validateAuthRequest((k) => (typeof form.get(k) === "string" ? String(form.get(k)) || null : null), base);
  if (req.kind === "fatal") redirect(`/oauth/authorize?error=${encodeURIComponent(req.message)}`);
  if (req.kind === "redirect_error") redirect(redirectWith(req.redirectUri, { error: req.error, state: req.state }, base));
  const ok = req;

  if (form.get("decision") !== "approve") {
    redirect(redirectWith(ok.redirectUri, { error: "access_denied", state: ok.state }, base));
  }
  // Em caso de erro volta ao ecrã com a mensagem exata e as escolhas preservadas.
  const back = (message: string) => {
    const q = new URLSearchParams();
    for (const k of KEYS) { const v = form.get(k); if (typeof v === "string") q.set(k, v); }
    q.set("form_error", message);
    const keep = (name: string, v: FormDataEntryValue | null) => { if (typeof v === "string" && v) q.set(name, v.slice(0, 2000)); };
    keep("preset", form.get("preset"));
    keep("duration", form.get("duration"));
    keep("devices", form.getAll("devices").map(String).join(","));
    keep("dirs", form.get("dirs"));
    keep("blockedDirs", form.get("blockedDirs"));
    if (form.get("allowAll") === "on") q.set("allowAll", "1");
    return `/oauth/authorize?${q}`;
  };

  const p = z.object({
    preset: z.enum(["read_only", "read_write", "terminal", "sudo_for_all"]),
    duration: z.enum(["1h", "24h", "30d", "never"]),
    dirs: z.string().max(4000).optional().default(""),
  }).safeParse(Object.fromEntries(form));
  if (!p.success) redirect(back("Dados inválidos. Revê as escolhas e tenta de novo."));
  const deviceIds = form.getAll("devices").map(String);
  if (!deviceIds.length) redirect(back("Escolhe pelo menos um dispositivo."));
  const dirs = parseDirFields(form, user.allowAllDirsOk);
  if ("error" in dirs) redirect(back(dirs.error));
  const ceiling = checkCeiling(user, { preset: p.data.preset });
  if (ceiling) redirect(back(ceiling));
  const sudoErr = checkSudo(p.data.preset, p.data.duration, form);
  if (sudoErr) redirect(back(sudoErr));

  const devs = await db().select({ id: schema.devices.id }).from(schema.devices).where(and(
    eq(schema.devices.userId, user.id), isNull(schema.devices.revokedAt), inArray(schema.devices.id, deviceIds)));
  if (!devs.length) redirect(back("Dispositivo inválido. Atualiza a página e escolhe de novo."));

  const ttl = DURATIONS[p.data.duration];
  const expiresAt = ttl ? new Date(Date.now() + ttl * 1000) : null;

  // Novo consentimento substitui os acessos anteriores deste cliente para este utilizador.
  await revokeClientForUser(user.id, ok.clientId);
  await db().insert(schema.clientGrants).values(devs.map((d) => ({
    userId: user.id, clientId: ok.clientId, deviceId: d.id, preset: p.data.preset,
    ...dirs.value, requireApprovalFor: p.data.preset === "terminal" ? ["start_process"] : [], expiresAt,
  })));

  const code = `mac_${randomBytes(32).toString("base64url")}`;
  await db().insert(schema.authCodes).values({
    codeHash: sha256(code), clientId: ok.clientId, userId: user.id, redirectUri: ok.redirectUri,
    codeChallenge: ok.challenge, resource: ok.resource, scope: ok.scope,
    expiresAt: new Date(Date.now() + 5 * 60_000),
  });
  await audit({ userId: user.id, clientId: ok.clientId, actor: "user", action: "oauth.consent", argsSummary: `${ok.clientName} ${p.data.preset} x${devs.length}` });
  redirect(redirectWith(ok.redirectUri, { code, state: ok.state }, base));
}
