import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/guard";
import { addGrant, createOAuthClient, disconnectAll, revokeGrant, revokeOAuthClient, updateGrant } from "@/lib/access-actions";
import { PanelForm } from "../panel-form";
import { ago, until } from "@/lib/format";
import { GrantFields } from "../grant-fields";
import { ConfirmButton } from "@/components/confirm-button";

const PRESET: Record<string, string> = {
  read_only: "Só leitura", read_write: "Leitura e escrita", terminal: "Terminal", custom: "Personalizado",
};

export default async function Clients() {
  const user = await requireUser();
  const [tokens, devices, grants] = await Promise.all([
    db().select().from(schema.accessTokens).where(and(
      eq(schema.accessTokens.userId, user.id), isNull(schema.accessTokens.revokedAt))).orderBy(desc(schema.accessTokens.createdAt)),
    db().select().from(schema.devices).where(and(eq(schema.devices.userId, user.id), isNull(schema.devices.revokedAt))),
    db().select().from(schema.clientGrants).where(and(
      eq(schema.clientGrants.userId, user.id), isNull(schema.clientGrants.revokedAt))),
  ]);
  const patIds = new Set(tokens.filter((t) => t.kind === "pat").map((t) => t.id));
  const oauthIds = [...new Set(grants.map((g) => g.clientId).filter((c) => !patIds.has(c)))];
  const oauthNames = oauthIds.length
    ? await db().select({ id: schema.oauthClients.clientId, name: schema.oauthClients.name }).from(schema.oauthClients)
        .where(inArray(schema.oauthClients.clientId, oauthIds))
    : [];
  const oauthLast = oauthIds.length
    ? await db().select({ id: schema.accessTokens.clientId, at: schema.accessTokens.lastUsedAt }).from(schema.accessTokens)
        .where(and(eq(schema.accessTokens.userId, user.id), inArray(schema.accessTokens.clientId, oauthIds)))
    : [];
  const entries = [
    ...tokens.filter((t) => t.kind === "pat").map((t) => ({
      key: t.id, title: t.name ?? "(sem nome)", kind: "pat", last: t.lastUsedAt,
      note: until(t.expiresAt),
    })),
    ...oauthIds.map((id) => ({
      key: id, title: oauthNames.find((n) => n.id === id)?.name ?? id, kind: "oauth",
      last: oauthLast.filter((l) => l.id === id).map((l) => l.at).filter((a): a is Date => !!a).sort((a, b) => b.getTime() - a.getTime())[0] ?? null,
      note: "OAuth",
    })),
  ];
  const now = Date.now();
  const devName = new Map(devices.map((d) => [d.id, d.name]));

  return (
    <main>
      <h1>Clientes ligados</h1>
      <p className="muted">Cada cliente só acede aos dispositivos para os quais tem um acesso ativo. Sem acesso, é negado.</p>
      <form action={disconnectAll} className="row"><ConfirmButton message="Revogar TODOS os acessos e tokens? Os clientes deixam de funcionar de imediato.">Desconectar tudo</ConfirmButton></form>

      {entries.length === 0 && <div className="empty"><strong>Nenhum cliente com acesso.</strong> Liga um em <a href="/connect">Ligar</a> ou cria um <a href="/tokens">token</a>.</div>}
      {entries.map((t) => {
        const own = grants.filter((g) => g.clientId === t.key);
        const free = devices.filter((d) => !own.some((g) => g.deviceId === d.id));
        return (
          <section key={t.key} className="panel">
            <h2>{t.title} <small>{t.kind === "oauth" ? "OAuth" : "token"}</small></h2>
            <p className="muted">Último uso: {ago(t.last)} · {t.note}</p>
            {t.kind === "oauth" && (
              <form action={revokeOAuthClient}><input type="hidden" name="clientId" value={t.key} /><ConfirmButton message="Revogar este cliente (tokens e acessos)?">Revogar cliente</ConfirmButton></form>
            )}
            {own.length === 0 && <p><em>Sem acesso a nenhum dispositivo.</em></p>}
            {own.map((g) => {
              const expired = g.expiresAt && g.expiresAt.getTime() < now;
              return (
                <details key={g.id}>
                  <summary>
                    <strong>{devName.get(g.deviceId) ?? "?"}</strong> — {PRESET[g.preset]}
                    {g.readOnly && " · só leitura"} · <span className={expired ? "alert" : "muted"}>{until(g.expiresAt)}</span>
                  </summary>
                  <PanelForm action={updateGrant} submit="Guardar alterações">
                    <input type="hidden" name="grantId" value={g.id} />
                    <GrantFields keepDuration d={{
                      preset: g.preset, dirs: g.allowedDirs, blocked: g.blockedCommands, readOnly: g.readOnly,
                      tools: g.allowedTools, approve: g.requireApprovalFor,
                    }} />
                  </PanelForm>
                  <form action={revokeGrant}>
                    <input type="hidden" name="grantId" value={g.id} /><ConfirmButton message="Revogar este acesso? O cliente perde o acesso de imediato.">Revogar este acesso</ConfirmButton>
                  </form>
                </details>
              );
            })}
            {free.length > 0 && (
              <details>
                <summary>Dar acesso a outro dispositivo</summary>
                <PanelForm action={addGrant} submit="Conceder acesso">
                  <input type="hidden" name="clientId" value={t.key} />
                  <select name="deviceId" required>{free.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
                  <GrantFields />
                </PanelForm>
              </details>
            )}
          </section>
        );
      })}
            <h2>Registar cliente OAuth</h2>
      <p className="muted">
        Para aplicações que pedem <strong>Client ID e Secret</strong> (por exemplo o Gemini web). As que se registam
        sozinhas (ChatGPT, Claude) não precisam disto. <strong>Nunca</strong> uses um token de acesso como Client ID.
      </p>
      <details>
        <summary>Novo cliente OAuth</summary>
        <PanelForm action={createOAuthClient} submit="Criar cliente" tokenLabel="Mostrado uma única vez — guarda o Secret agora">
          <label>Nome <input name="name" required maxLength={80} placeholder="Gemini web" /></label>
          <label>Redirect URI (um por linha — copia-o do ecrã da aplicação)
            <textarea name="uris" rows={2} required placeholder="https://…" />
          </label>
        </PanelForm>
      </details>
    </main>
  );
}
