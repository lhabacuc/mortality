import { desc, eq } from "drizzle-orm";
import { createInvite, revokeInvite } from "@/lib/admin-actions";
import { db, schema } from "@/lib/db";
import { requireAdmin } from "@/lib/guard";
import { PanelForm } from "../../panel-form";

export default async function Invites() {
  await requireAdmin();
  const rows = await db().select({ i: schema.invites, by: schema.users.email }).from(schema.invites)
    .leftJoin(schema.users, eq(schema.users.id, schema.invites.createdBy)).orderBy(desc(schema.invites.createdAt)).limit(100);
  const now = Date.now();
  return (
    <main>
      <h1>Convites</h1>
      <p>Cada convite é de uso único e cria a conta já aprovada. Modo de registo atual: <code>{process.env.SIGNUP_MODE ?? "approval"}</code>.</p>
      <PanelForm action={createInvite} submit="Gerar convite" tokenLabel="Link do convite (mostrado uma única vez)">
        <input name="email" type="email" aria-label="Email do convidado" placeholder="Email (opcional: restringe o convite)" />
        <label>Validade (dias) <input name="days" type="number" min={1} max={30} defaultValue={7} /></label>
      </PanelForm>
      <div className="table-wrap"><table>
        <thead><tr><th align="left">Email</th><th align="left">Criado por</th><th align="left">Estado</th><th /></tr></thead>
        <tbody>
          {rows.map(({ i, by }) => {
            const state = i.usedAt ? "usado" : i.expiresAt.getTime() < now ? "expirado" : "pendente";
            return (
              <tr key={i.id}>
                <td>{i.email ?? "(qualquer)"}</td><td>{by}</td><td>{state}</td>
                <td>{state === "pendente" && (
                  <form action={revokeInvite}><input type="hidden" name="id" value={i.id} /><button>Revogar</button></form>
                )}</td>
              </tr>
            );
          })}
        </tbody>
      </table></div>
      <p><a href="/admin">Voltar</a></p>
    </main>
  );
}
