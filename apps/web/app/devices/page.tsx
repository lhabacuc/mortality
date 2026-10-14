import { desc, eq, and, isNull } from "drizzle-orm";
import { ONLINE_THRESHOLD_MS } from "@mortality/shared";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/guard";
import { deviceAction } from "@/lib/panel-actions";
import { appUrl } from "@/lib/app-url";

export default async function Devices() {
  const user = await requireUser();
  const rows = await db().select().from(schema.devices)
    .where(and(eq(schema.devices.userId, user.id), isNull(schema.devices.revokedAt)))
    .orderBy(desc(schema.devices.createdAt));
  const btn = (id: string, op: string, label: string) => (
    <form action={deviceAction} style={{ display: "inline" }}>
      <input type="hidden" name="deviceId" value={id} /><input type="hidden" name="op" value={op} />
      <button>{label}</button>
    </form>
  );
  return (
    <main>
      <h1>Dispositivos</h1>
      <p>Para adicionar: instala a CLI e corre <code>mortality install --server {appUrl()}</code>, depois confirma o código em <a href="/device">/device</a>.</p>
      <table width="100%">
        <thead><tr><th align="left">Nome</th><th>SO</th><th>Estado</th><th>Relay</th><th /></tr></thead>
        <tbody>
          {rows.map((d) => {
            const online = !!d.lastSeenAt && Date.now() - d.lastSeenAt.getTime() < ONLINE_THRESHOLD_MS;
            return (
              <tr key={d.id}>
                <td>{d.name}</td><td align="center">{d.os ?? "—"}</td>
                <td align="center">{d.pausedLocally ? "pausado localmente" : online ? "online" : "offline"}{!d.enabled && " · desativado"}</td>
                <td align="center">{d.relayVersion ?? "—"}</td>
                <td>{btn(d.id, d.enabled ? "disable" : "enable", d.enabled ? "Desativar" : "Ativar")} {btn(d.id, "revoke", "Revogar")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p><a href="/dashboard">Voltar</a></p>
    </main>
  );
}
