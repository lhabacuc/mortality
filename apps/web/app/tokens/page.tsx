import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/guard";
import { createPat, revokePat } from "@/lib/panel-actions";
import { PanelForm } from "../panel-form";
import { DirFields } from "../dir-fields";
import { SudoConfirm } from "../grant-fields";
import { checkCeiling } from "@mortality/shared";
import { ConfirmButton } from "@/components/confirm-button";
import { ago, until } from "@/lib/format";

export default async function Tokens() {
  const user = await requireUser();
  const devices = await db().select().from(schema.devices)
    .where(and(eq(schema.devices.userId, user.id), isNull(schema.devices.revokedAt)));
  const pats = await db().select().from(schema.accessTokens)
    .where(and(eq(schema.accessTokens.userId, user.id), eq(schema.accessTokens.kind, "pat"), isNull(schema.accessTokens.revokedAt)))
    .orderBy(desc(schema.accessTokens.createdAt));
  return (
    <main>
      <h1>Tokens</h1>
      <p className="muted">Para clientes sem OAuth. Cada token nasce sem acesso: defines já o dispositivo, as permissões e os diretórios.</p>
      {devices.length === 0 ? <div className="empty"><strong>Falta um dispositivo.</strong> <a href="/devices">Adiciona um</a> antes de criar tokens.</div> : (
        <PanelForm action={createPat} submit="Criar token">
          <input name="name" aria-label="Nome do token" placeholder="Nome (ex.: Claude Code)" required maxLength={60} />
          <select name="deviceId" required>{devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <select name="preset" defaultValue="read_only">
            <option value="read_only">Só leitura</option>
            <option value="read_write">Leitura e escrita</option>
            <option value="terminal">Terminal</option>
            {!checkCeiling(user, { preset: "sudo_for_all" }) && <option value="sudo_for_all">sudo-for-all (acesso total)</option>}
          </select>
          <select name="duration" defaultValue="24h">
            <option value="1h">1 hora</option><option value="24h">24 horas</option>
            <option value="30d">30 dias</option><option value="never">Até revogar</option>
          </select>
          <DirFields allowAllOk={user.allowAllDirsOk} />
          {!checkCeiling(user, { preset: "sudo_for_all" }) && <SudoConfirm />}
        </PanelForm>
      )}
      <h2>Ativos</h2>
      {pats.length === 0 ? <p className="muted">Nenhum token ativo.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Nome</th><th>Último uso</th><th>Validade</th><th /></tr></thead>
            <tbody>
              {pats.map((t) => (
                <tr key={t.id}>
                  <td><strong>{t.name}</strong></td>
                  <td className="muted">{ago(t.lastUsedAt)}</td>
                  <td className="muted">{until(t.expiresAt)}</td>
                  <td className="act">
                    <form action={revokePat} className="inline">
                      <input type="hidden" name="id" value={t.id} />
                      <ConfirmButton message={`Revogar o token "${t.name}"?`}>Revogar</ConfirmButton>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
