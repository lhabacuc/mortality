import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/guard";
import { disconnectAll } from "@/lib/access-actions";
import { AutoRefresh } from "../auto-refresh";
import { actionLabel } from "@/lib/format";
import { ConfirmButton } from "@/components/confirm-button";

export default async function Activity({ searchParams }: { searchParams: Promise<{ failed?: string }> }) {
  const user = await requireUser();
  const { failed } = await searchParams;
  const rows = await db().select({
    a: schema.auditLog, device: schema.devices.name, client: schema.accessTokens.name,
  }).from(schema.auditLog)
    .leftJoin(schema.devices, eq(schema.devices.id, schema.auditLog.deviceId))
    .leftJoin(schema.accessTokens, sql`${schema.accessTokens.id}::text = ${schema.auditLog.clientId}`)
    .where(and(eq(schema.auditLog.userId, user.id), failed ? eq(schema.auditLog.ok, false) : undefined))
    .orderBy(desc(schema.auditLog.createdAt)).limit(100);

  return (
    <main>
      <AutoRefresh />
      <h1>Atividade</h1>
      <p className="muted"><a href="/activity" aria-current={failed ? undefined : "page"}>Tudo</a> · <a href="/activity?failed=1" aria-current={failed ? "page" : undefined}>Só falhas</a> · atualiza a cada 5 s</p>
      <form action={disconnectAll}><ConfirmButton message="Revogar TODOS os acessos e tokens?">Desconectar tudo</ConfirmButton></form>
      <div className="table-wrap"><table>
        <thead><tr><th align="left">Quando</th><th align="left">Ação</th><th align="left">Tool</th><th align="left">Dispositivo</th><th align="left">Cliente</th></tr></thead>
        <tbody>
          {rows.map(({ a, device, client }) => (
            <tr key={a.id}>
              <td className="muted mono">{a.createdAt.toISOString().slice(5, 19).replace("T", " ")}</td>
              <td><span className={`dot ${a.ok ? "ok" : "bad"}`} />{actionLabel(a.action)}</td>
              <td title={a.argsSummary ?? ""}>{a.tool ?? "—"}</td>
              <td>{device ?? "—"}</td>
              <td>{client ?? (a.actor === "user" ? "(tu)" : "—")}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
          </main>
  );
}
