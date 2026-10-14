"use server";

import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SignupMode } from "@mortality/shared";
import { db, schema } from "./db";
import { hashPassword, verifyPassword } from "./password";
import { clearPending, currentUser, endSession, readPending, startPending, startSession } from "./session";
import { decryptSecret, verifyTotp } from "./totp";
import { ensureAdmin } from "./bootstrap";
import { safeNext } from "./oauth";
import { allow, ipFromHeaders } from "./ratelimit";
import { audit } from "./audit";
import { sha256 } from "./tokens";

const Email = z.string().trim().toLowerCase().email().max(254);
const Pass = z.string().min(10, "mínimo 10 caracteres").max(200);
const GENERIC = "Credenciais inválidas.";

export type FormState = { error?: string } | undefined;

export async function signup(_: FormState, form: FormData): Promise<FormState> {
  const ip = ipFromHeaders(await headers());
  if (!(await allow(`signup:${ip}`, 10, 3600))) return { error: "Demasiados registos. Tenta mais tarde." };
  const parsed = z.object({
    email: Email, password: Pass, name: z.string().trim().min(1).max(80),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const mode = SignupMode.catch("approval").parse(process.env.SIGNUP_MODE);
  const { email, password, name } = parsed.data;
  const inviteRaw = String(form.get("invite") ?? "");

  // Convite: uso único, pré-aprova a conta em qualquer modo.
  let inviteHash: string | null = null;
  if (inviteRaw) {
    inviteHash = sha256(inviteRaw);
    const claimed = await db().update(schema.invites).set({ usedAt: new Date() })
      .where(and(eq(schema.invites.tokenHash, inviteHash), isNull(schema.invites.usedAt), gt(schema.invites.expiresAt, new Date())))
      .returning({ email: schema.invites.email });
    if (!claimed.length) return { error: "Convite inválido, expirado ou já usado." };
    if (claimed[0].email && claimed[0].email !== email) {
      await db().update(schema.invites).set({ usedAt: null }).where(eq(schema.invites.tokenHash, inviteHash));
      return { error: "Este convite é para outro email." };
    }
  } else if (mode === "invite_only") {
    return { error: "Registo apenas por convite." };
  }

  const inserted = await db().insert(schema.users).values({
    email, name, passwordHash: await hashPassword(password),
    status: inviteHash || mode === "open" ? "active" : "pending",
  }).onConflictDoNothing().returning({ id: schema.users.id });
  if (!inserted.length) {
    if (inviteHash) await db().update(schema.invites).set({ usedAt: null }).where(eq(schema.invites.tokenHash, inviteHash));
    return { error: "Não foi possível criar a conta." };
  }
  if (inviteHash) await db().update(schema.invites).set({ usedBy: inserted[0].id }).where(eq(schema.invites.tokenHash, inviteHash));
  redirect("/login?registered=1");
}

export async function login(_: FormState, form: FormData): Promise<FormState> {
  await ensureAdmin();
  const parsed = z.object({ email: Email, password: z.string().max(200) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: GENERIC };
  const ip = ipFromHeaders(await headers());
  if (!(await allow(`login:ip:${ip}`, 30, 600)) || !(await allow(`login:email:${parsed.data.email}`, 10, 600))) {
    return { error: "Demasiadas tentativas. Tenta mais tarde." };
  }

  const [user] = await db().select().from(schema.users)
    .where(eq(schema.users.email, parsed.data.email)).limit(1);
  const ok = user
    ? await verifyPassword(parsed.data.password, user.passwordHash)
    : await verifyPassword(parsed.data.password, "scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AA==");
  if (!user || !ok) return { error: GENERIC };
  if (user.status === "suspended") return { error: "Conta suspensa." };
  if (user.status === "pending") return { error: "Conta a aguardar aprovação do administrador." };

  const next = safeNext(form.get("next") as string | null);
  if (user.totpEnabled) {
    await startPending(user.id);
    redirect(next ? `/login/2fa?next=${encodeURIComponent(next)}` : "/login/2fa");
  }
  await startSession(user.id);
  redirect(user.mustChangePassword ? "/change-password" : (next ?? "/dashboard"));
}

/** 2º passo do login: código TOTP ou recovery code (uso único). */
export async function verify2fa(_: FormState, form: FormData): Promise<FormState> {
  const userId = await readPending();
  if (!userId) redirect("/login");
  if (!(await allow(`2fa:${userId}`, 5, 300))) return { error: "Demasiadas tentativas. Tenta mais tarde." };
  const [user] = await db().select().from(schema.users).where(eq(schema.users.id, userId)).limit(1);
  if (!user || user.status !== "active" || !user.totpEnabled || !user.totpSecretEnc) redirect("/login");

  const code = String(form.get("code") ?? "").trim().toUpperCase();
  let ok = false;
  if (/^\d{6}$/.test(code)) {
    const step = verifyTotp(decryptSecret(user.totpSecretEnc), code, Date.now(), user.totpLastStep);
    if (step !== null) {
      // Atómico: o mesmo código não pode ser usado duas vezes.
      const upd = await db().update(schema.users).set({ totpLastStep: step })
        .where(and(eq(schema.users.id, user.id), user.totpLastStep === null ? isNull(schema.users.totpLastStep) : eq(schema.users.totpLastStep, user.totpLastStep)))
        .returning({ id: schema.users.id });
      ok = upd.length > 0;
    }
  } else if (/^[A-Z0-9]{5}-[A-Z0-9]{5}$/.test(code)) {
    const h = sha256(code);
    if (user.totpRecovery.includes(h)) {
      const left = user.totpRecovery.filter((x) => x !== h);
      const upd = await db().update(schema.users).set({ totpRecovery: left })
        .where(and(eq(schema.users.id, user.id), sql`${h} = any(${schema.users.totpRecovery})`)).returning({ id: schema.users.id });
      ok = upd.length > 0;
      if (ok) await audit({ userId: user.id, actor: "user", action: "totp.recovery_used" });
    }
  }
  if (!ok) {
    await audit({ userId: user.id, actor: "user", action: "totp.failed", ok: false, ip: ipFromHeaders(await headers()) });
    return { error: "Código inválido." };
  }
  await clearPending();
  await startSession(user.id);
  const next = safeNext(form.get("next") as string | null);
  redirect(user.mustChangePassword ? "/change-password" : (next ?? "/dashboard"));
}

export async function logout() {
  await endSession();
  redirect("/login");
}

export async function changePassword(_: FormState, form: FormData): Promise<FormState> {
  const user = await currentUser();
  if (!user) redirect("/login");
  const parsed = z.object({ current: z.string().max(200), next: Pass })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  if (!(await verifyPassword(parsed.data.current, user.passwordHash))) return { error: "Password atual incorreta." };
  if (parsed.data.current === parsed.data.next) return { error: "A nova password tem de ser diferente." };

  await db().update(schema.users)
    .set({ passwordHash: await hashPassword(parsed.data.next), mustChangePassword: false })
    .where(eq(schema.users.id, user.id));
  redirect("/dashboard");
}

const AdminOp = z.object({
  userId: z.string().uuid(),
  op: z.enum(["approve", "reject", "suspend", "reactivate"]),
});

export async function adminUserAction(form: FormData) {
  const admin = await currentUser();
  if (!admin || admin.role !== "admin" || admin.mustChangePassword) redirect("/login");
  if (process.env.REQUIRE_ADMIN_TOTP === "1" && !admin.totpEnabled) redirect("/security");
  const { userId, op } = AdminOp.parse(Object.fromEntries(form));
  if (userId === admin.id) return; // nunca atuar sobre si próprio (evita ficar sem admin)

  const target = and(eq(schema.users.id, userId), ne(schema.users.role, "admin"));
  if (op === "reject") {
    await db().delete(schema.users).where(and(target, eq(schema.users.status, "pending")));
  } else if (op === "approve") {
    await db().update(schema.users)
      .set({ status: "active", approvedBy: admin.id, approvedAt: new Date() })
      .where(and(target, eq(schema.users.status, "pending")));
  } else if (op === "suspend") {
    await db().update(schema.users).set({ status: "suspended" })
      .where(and(target, eq(schema.users.status, "active")));
  } else {
    await db().update(schema.users).set({ status: "active" })
      .where(and(target, eq(schema.users.status, "suspended")));
  }
  await audit({ userId, actor: "admin", action: `admin.user.${op}`, argsSummary: `by ${admin.email}` });
  revalidatePath("/admin");
}
