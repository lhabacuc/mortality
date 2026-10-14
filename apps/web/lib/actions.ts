"use server";

import { and, eq, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SignupMode } from "@mortality/shared";
import { db, schema } from "./db";
import { hashPassword, verifyPassword } from "./password";
import { currentUser, endSession, startSession } from "./session";
import { ensureAdmin } from "./bootstrap";

const Email = z.string().trim().toLowerCase().email().max(254);
const Pass = z.string().min(10, "mínimo 10 caracteres").max(200);
const GENERIC = "Credenciais inválidas.";

export type FormState = { error?: string } | undefined;

export async function signup(_: FormState, form: FormData): Promise<FormState> {
  const parsed = z.object({
    email: Email, password: Pass, name: z.string().trim().min(1).max(80),
  }).safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const mode = SignupMode.catch("approval").parse(process.env.SIGNUP_MODE);
  if (mode === "invite_only") return { error: "Registo apenas por convite." };

  const { email, password, name } = parsed.data;
  const inserted = await db().insert(schema.users).values({
    email, name, passwordHash: await hashPassword(password),
    status: mode === "open" ? "active" : "pending",
  }).onConflictDoNothing().returning({ id: schema.users.id });
  if (!inserted.length) return { error: "Não foi possível criar a conta." };
  redirect("/login?registered=1");
}

export async function login(_: FormState, form: FormData): Promise<FormState> {
  await ensureAdmin();
  const parsed = z.object({ email: Email, password: z.string().max(200) })
    .safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: GENERIC };

  const [user] = await db().select().from(schema.users)
    .where(eq(schema.users.email, parsed.data.email)).limit(1);
  const ok = user
    ? await verifyPassword(parsed.data.password, user.passwordHash)
    : await verifyPassword(parsed.data.password, "scrypt$16384$AAAAAAAAAAAAAAAAAAAAAA==$AA==");
  if (!user || !ok) return { error: GENERIC };
  if (user.status === "suspended") return { error: "Conta suspensa." };
  if (user.status === "pending") return { error: "Conta a aguardar aprovação do administrador." };

  await startSession(user.id);
  redirect(user.mustChangePassword ? "/change-password" : "/dashboard");
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
  revalidatePath("/admin");
}
