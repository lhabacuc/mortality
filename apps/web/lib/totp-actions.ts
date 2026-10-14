"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "./audit";
import { db, schema } from "./db";
import { requireUser } from "./guard";
import { verifyPassword } from "./password";
import type { PanelState } from "./panel-actions";
import { allow } from "./ratelimit";
import { sha256 } from "./tokens";
import { decryptSecret, encryptSecret, newRecoveryCodes, newTotpSecret, verifyTotp } from "./totp";

export async function beginTotp() {
  const user = await requireUser();
  if (user.totpEnabled) return;
  await db().update(schema.users).set({
    totpSecretEnc: encryptSecret(newTotpSecret()), totpEnabled: false, totpRecovery: [], totpLastStep: null,
  }).where(eq(schema.users.id, user.id));
  redirect("/security");
}

export async function confirmTotp(_: PanelState, form: FormData): Promise<PanelState> {
  const user = await requireUser();
  if (!user.totpSecretEnc || user.totpEnabled) return { error: "Inicia a configuração primeiro." };
  if (!(await allow(`totp-confirm:${user.id}`, 10, 600))) return { error: "Demasiadas tentativas." };
  const step = verifyTotp(decryptSecret(user.totpSecretEnc), String(form.get("code") ?? "").trim());
  if (step === null) return { error: "Código inválido. Confirma a hora do telemóvel." };

  const codes = newRecoveryCodes();
  await db().update(schema.users).set({
    totpEnabled: true, totpLastStep: step, totpRecovery: codes.map(sha256),
  }).where(eq(schema.users.id, user.id));
  await audit({ userId: user.id, actor: "user", action: "totp.enabled" });
  // Sem revalidatePath: re-renderizar a página desmontaria o formulário que mostra os códigos (só aparecem uma vez).
  return { token: codes.join("\n") };
}

export async function disableTotp(_: PanelState, form: FormData): Promise<PanelState> {
  const user = await requireUser();
  if (!(await allow(`totp-disable:${user.id}`, 5, 600))) return { error: "Demasiadas tentativas." };
  const p = z.object({ password: z.string().max(200), code: z.string().trim() }).safeParse(Object.fromEntries(form));
  if (!p.success || !user.totpSecretEnc) return { error: "Dados inválidos." };
  if (!(await verifyPassword(p.data.password, user.passwordHash))) return { error: "Password incorreta." };
  const step = verifyTotp(decryptSecret(user.totpSecretEnc), p.data.code, Date.now(), user.totpLastStep);
  if (step === null) return { error: "Código inválido." };

  await db().update(schema.users).set({
    totpEnabled: false, totpSecretEnc: null, totpRecovery: [], totpLastStep: null,
  }).where(eq(schema.users.id, user.id));
  await audit({ userId: user.id, actor: "user", action: "totp.disabled" });
  revalidatePath("/security");
  return { ok: "2FA desativado." };
}
