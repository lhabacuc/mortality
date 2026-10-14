import Link from "next/link";
import { redirect } from "next/navigation";
import { logout } from "@/lib/actions";
import { and, count, eq, gt } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { currentUser } from "@/lib/session";

export default async function Dashboard() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  if (user.status !== "active") redirect("/login");
  const [{ n: pending }] = await db().select({ n: count() }).from(schema.jobs).where(and(
    eq(schema.jobs.userId, user.id), eq(schema.jobs.status, "awaiting_approval"), gt(schema.jobs.expiresAt, new Date())));
  return (
    <main>
      <h1>Olá, {user.name}</h1>
      <ul>
        <li><Link href="/devices">Dispositivos</Link></li>
        <li><Link href="/device">Emparelhar dispositivo</Link></li>
        <li><Link href="/tokens">Tokens de acesso</Link></li>
        <li><Link href="/clients">Clientes ligados e grants</Link></li>
        <li><Link href="/approvals">Aprovações pendentes{pending > 0 && ` (${pending})`}</Link></li>
        <li><Link href="/activity">Atividade</Link></li>
      </ul>
      {user.role === "admin" && <p><Link href="/admin">Administração</Link></p>}
      <form action={logout}><button>Sair</button></form>
    </main>
  );
}
