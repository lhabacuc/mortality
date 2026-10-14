import { and, asc, eq, lt, sql } from "drizzle-orm";
import { decideApproval } from "@/lib/approval-actions";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/guard";
import { countdown } from "@/lib/format";
import { AutoRefresh } from "../auto-refresh";

export default async function Approvals() {
  const user = await requireUser();
  // Pedidos expirados deixam de poder ser aprovados.
  await db().update(schema.jobs).set({ status: "denied", error: "approval_timeout", completedAt: new Date() })
    .where(and(eq(schema.jobs.userId, user.id), eq(schema.jobs.status, "awaiting_approval"), lt(schema.jobs.expiresAt, new Date())));

  const rows = await db().select({
    j: schema.jobs, device: schema.devices.name, client: schema.accessTokens.name, oauth: schema.oauthClients.name,
  }).from(schema.jobs)
    .leftJoin(schema.devices, eq(schema.devices.id, schema.jobs.deviceId))
    .leftJoin(schema.accessTokens, sql`${schema.accessTokens.id}::text = ${schema.jobs.clientId}`)
    .leftJoin(schema.oauthClients, eq(schema.oauthClients.clientId, schema.jobs.clientId))
    .where(and(eq(schema.jobs.userId, user.id), eq(schema.jobs.status, "awaiting_approval")))
    .orderBy(asc(schema.jobs.createdAt));

  return (
    <main>
      <AutoRefresh seconds={3} />
      <h1>Aprovações</h1>
      <p className="muted">O cliente fica à espera. Se não decidires a tempo, o pedido é negado.</p>
      {rows.length === 0 && <div className="empty">Nada para decidir. Os pedidos sensíveis aparecem aqui assim que chegam.</div>}
      {rows.map(({ j, device, client, oauth }) => {
        const summary = (j.args as { summary?: string }).summary ?? j.tool;
        const left = Math.max(0, Math.round((j.expiresAt.getTime() - Date.now()) / 1000));
        return (
          <section key={j.id} className="approval" aria-label={`Pedido de ${client ?? oauth ?? "cliente"}`}>
            <p className="who">
              <strong>{client ?? oauth ?? "Cliente"}</strong> quer usar <code>{j.tool}</code> em <strong>{device ?? "?"}</strong>
              <span className="left"> · {countdown(left)}</span>
            </p>
            <pre>{summary}</pre>
            <form action={decideApproval} className="row">
              <input type="hidden" name="jobId" value={j.id} />
              <button name="decision" value="approve" className="primary">Aprovar</button>
              <button name="decision" value="deny">Negar</button>
            </form>
          </section>
        );
      })}
    </main>
  );
}
