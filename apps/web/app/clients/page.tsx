import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/guard";
import { addGrant, disconnectAll, revokeGrant, updateGrant } from "@/lib/access-actions";
import { PanelForm } from "../panel-form";
import { GrantFields } from "../grant-fields";

const PRESET: Record<string, string> = {
  read_only: "Só leitura", read_write: "Leitura e escrita", terminal: "Terminal", custom: "Personalizado",
};
const when = (d: Date | null, none = "—") => (d ? d.toISOString().slice(0, 16).replace("T", " ") : none);

export default async function Clients() {
  const user = await requireUser();
  const [tokens, devices, grants] = await Promise.all([
    db().select().from(schema.accessTokens).where(and(
      eq(schema.accessTokens.userId, user.id), isNull(schema.accessTokens.revokedAt))).orderBy(desc(schema.accessTokens.createdAt)),
    db().select().from(schema.devices).where(and(eq(schema.devices.userId, user.id), isNull(schema.devices.revokedAt))),
    db().select().from(schema.clientGrants).where(and(
      eq(schema.clientGrants.userId, user.id), isNull(schema.clientGrants.revokedAt))),
  ]);
  const now = Date.now();
  const devName = new Map(devices.map((d) => [d.id, d.name]));

  return (
    <main>
      <h1>Clientes ligados</h1>
      <p>Cada cliente só acede aos dispositivos para os quais tem um grant ativo. Sem grant, o acesso é negado.</p>
      <form action={disconnectAll}><button>Desconectar tudo</button></form>

      {tokens.length === 0 && <p>Nenhum cliente. Cria um token em <a href="/tokens">Tokens</a>.</p>}
      {tokens.map((t) => {
        const own = grants.filter((g) => g.clientId === (t.clientId ?? t.id));
        const free = devices.filter((d) => !own.some((g) => g.deviceId === d.id));
        return (
          <section key={t.id} style={{ border: "1px solid #888", padding: 12, margin: "16px 0" }}>
            <h2 style={{ marginTop: 0 }}>{t.name ?? "(sem nome)"} <small>({t.kind})</small></h2>
            <p>Último uso: {when(t.lastUsedAt, "nunca")} · Token {t.expiresAt ? `expira ${when(t.expiresAt)}` : "sem expiração"}</p>
            {own.length === 0 && <p><em>Sem acesso a nenhum dispositivo.</em></p>}
            {own.map((g) => {
              const expired = g.expiresAt && g.expiresAt.getTime() < now;
              return (
                <details key={g.id} style={{ margin: "8px 0" }}>
                  <summary>
                    <strong>{devName.get(g.deviceId) ?? "?"}</strong> — {PRESET[g.preset]}
                    {g.readOnly && " · só leitura"} · {g.expiresAt ? `${expired ? "EXPIRADO " : "expira "}${when(g.expiresAt)}` : "sem expiração"}
                  </summary>
                  <PanelForm action={updateGrant} submit="Guardar alterações">
                    <input type="hidden" name="grantId" value={g.id} />
                    <GrantFields keepDuration d={{
                      preset: g.preset, dirs: g.allowedDirs, blocked: g.blockedCommands, readOnly: g.readOnly,
                      tools: g.allowedTools, approveProcess: g.requireApprovalFor.includes("start_process"),
                    }} />
                  </PanelForm>
                  <form action={revokeGrant}>
                    <input type="hidden" name="grantId" value={g.id} /><button>Revogar este acesso</button>
                  </form>
                </details>
              );
            })}
            {free.length > 0 && (
              <details>
                <summary>Dar acesso a outro dispositivo</summary>
                <PanelForm action={addGrant} submit="Conceder acesso">
                  <input type="hidden" name="clientId" value={t.id} />
                  <select name="deviceId" required>{free.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
                  <GrantFields />
                </PanelForm>
              </details>
            )}
          </section>
        );
      })}
      <p><a href="/dashboard">Voltar</a></p>
    </main>
  );
}
