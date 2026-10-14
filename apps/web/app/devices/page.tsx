import { desc, eq, and, isNull } from "drizzle-orm";
import Link from "next/link";
import { ONLINE_THRESHOLD_MS } from "@mortality/shared";
import { appUrl } from "@/lib/app-url";
import { db, schema } from "@/lib/db";
import { ago } from "@/lib/format";
import { requireUser } from "@/lib/guard";
import { deviceAction } from "@/lib/panel-actions";
import { ConfirmButton } from "@/components/confirm-button";
import { CodeBlock } from "@/components/code-block";

export default async function Devices() {
  const user = await requireUser();
  const rows = await db().select().from(schema.devices)
    .where(and(eq(schema.devices.userId, user.id), isNull(schema.devices.revokedAt)))
    .orderBy(desc(schema.devices.createdAt));
  const act = (id: string, op: string, label: string, confirm?: string) => (
    <form action={deviceAction} className="inline">
      <input type="hidden" name="deviceId" value={id} /><input type="hidden" name="op" value={op} />
      {confirm ? <ConfirmButton message={confirm} className="danger sm">{label}</ConfirmButton> : <button className="sm">{label}</button>}
    </form>
  );
  return (
    <main>
      <h1>Dispositivos</h1>
      {rows.length === 0 ? (
        <div className="empty"><strong>Ainda não há dispositivos.</strong> Instala o relay no computador que queres ligar:</div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Nome</th><th>Estado</th><th>Visto</th><th>Sistema</th><th /></tr></thead>
            <tbody>
              {rows.map((d) => {
                const online = !!d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < ONLINE_THRESHOLD_MS;
                const [cls, text] = !d.enabled ? ["off", "desativado"] : d.pausedLocally ? ["warn", "pausado localmente"] : online ? ["ok", "online"] : ["bad", "offline"];
                return (
                  <tr key={d.id}>
                    <td><strong>{d.name}</strong></td>
                    <td><span className={`dot ${cls}`} />{text}</td>
                    <td className="muted">{ago(d.lastSeenAt)}</td>
                    <td className="muted mono">{d.os ?? "—"}{d.relayVersion ? ` · v${d.relayVersion}` : ""}</td>
                    <td className="act">
                      {act(d.id, d.enabled ? "disable" : "enable", d.enabled ? "Desativar" : "Ativar")}{" "}
                      {act(d.id, "revoke", "Remover", `Remover "${d.name}"? Revoga o relay e todos os acessos a este dispositivo.`)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <h2>Adicionar dispositivo</h2>
      <CodeBlock>{`mortality install --server ${appUrl()}`}</CodeBlock>
      <p className="muted">Depois confirma o código em <Link href="/device">Emparelhar dispositivo</Link>. Precisas de ajuda? <Link href="/guide">Guia</Link>.</p>
    </main>
  );
}
