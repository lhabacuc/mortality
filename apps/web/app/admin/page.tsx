import { desc } from "drizzle-orm";
import { redirect } from "next/navigation";
import { adminUserAction } from "@/lib/actions";
import { db, schema } from "@/lib/db";
import { currentUser } from "@/lib/session";

const OPS: Record<string, [string, string][]> = {
  pending: [["approve", "Aprovar"], ["reject", "Recusar"]],
  active: [["suspend", "Suspender"]],
  suspended: [["reactivate", "Reativar"]],
};

export default async function Admin() {
  const me = await currentUser();
  if (!me || me.role !== "admin" || me.mustChangePassword) redirect("/login");
  if (process.env.REQUIRE_ADMIN_TOTP === "1" && !me.totpEnabled) redirect("/security");
  const users = await db().select().from(schema.users).orderBy(desc(schema.users.createdAt));
  return (
    <main>
      <h1>Utilizadores</h1>
      <p><a href="/admin/invites">Convites</a> · <a href="/admin/audit">Audit global</a></p>
      <table width="100%">
        <thead><tr><th align="left">Email</th><th>Papel</th><th>Estado</th><th /></tr></thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td><a href={`/admin/users/${u.id}`}>{u.email}</a></td><td align="center">{u.role}</td><td align="center">{u.status}</td>
              <td>
                {u.role !== "admin" && OPS[u.status]?.map(([op, label]) => (
                  <form key={op} action={adminUserAction} style={{ display: "inline" }}>
                    <input type="hidden" name="userId" value={u.id} />
                    <input type="hidden" name="op" value={op} />
                    <button>{label}</button>
                  </form>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p><a href="/dashboard">Voltar</a></p>
    </main>
  );
}
