import { requireAdmin } from "@/lib/guard";
import { parseFilters, queryAudit } from "@/lib/audit-query";

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireAdmin();
  const sp = await searchParams;
  const f = parseFilters(sp, 200);
  const rows = await queryAudit(f);
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <main style={{ maxWidth: 1100 }}>
      <h1>Audit global</h1>
      <form method="get" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input name="email" placeholder="email" defaultValue={sp.email} />
        <input name="action" placeholder="ação (prefixo)" defaultValue={sp.action} />
        <input name="tool" placeholder="tool" defaultValue={sp.tool} />
        <input name="from" type="date" defaultValue={sp.from} />
        <input name="to" type="date" defaultValue={sp.to} />
        <label><input type="checkbox" name="failed" value="1" defaultChecked={sp.failed === "1"} /> só falhas</label>
        <button>Filtrar</button>
        <a href={`/admin/audit/export?${qs}`}>Exportar CSV</a>
      </form>
      <table width="100%" style={{ fontSize: 13, marginTop: 12 }}>
        <thead><tr><th align="left">Quando</th><th align="left">Utilizador</th><th align="left">Ator</th><th align="left">Ação</th><th align="left">Tool</th><th align="left">Dispositivo</th><th>OK</th><th align="left">IP</th></tr></thead>
        <tbody>
          {rows.map(({ a, email, device }) => (
            <tr key={a.id}>
              <td>{a.createdAt.toISOString().slice(0, 19).replace("T", " ")}</td><td>{email ?? "—"}</td><td>{a.actor}</td>
              <td title={a.argsSummary ?? ""}>{a.action}</td><td>{a.tool ?? "—"}</td><td>{device ?? "—"}</td>
              <td align="center">{a.ok ? "✓" : "✗"}</td><td>{a.ip ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p><a href="/admin">Voltar</a></p>
    </main>
  );
}
