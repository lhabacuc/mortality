import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { hashPassword } from "./password";

/** Cria o admin inicial (ADMIN_EMAIL/ADMIN_PASSWORD) se ainda não existir nenhum admin. */
export async function ensureAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) return;
  const [existing] = await db().select({ id: schema.users.id }).from(schema.users)
    .where(eq(schema.users.role, "admin")).limit(1);
  if (existing) return;
  await db().insert(schema.users).values({
    email, name: "Admin", role: "admin", status: "active",
    passwordHash: await hashPassword(password), mustChangePassword: true,
    approvedAt: new Date(),
  }).onConflictDoNothing();
}
