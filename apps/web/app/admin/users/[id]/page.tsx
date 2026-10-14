import { and, desc, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";
import { ALL_TOOLS } from "@mortality/shared";
import { adminRevoke, deleteUser, revokeAllForUser, setLimits, setRole } from "@/lib/admin-actions";
import { db, schema } from "@/lib/db";
import { requireAdmin } from "@/lib/guard";
import { PanelForm } from "../../../panel-form";

const when = (d: Date | null) => (d ? d.toISOString().slice(0, 16).replace("T", " ") : "—");

export default async function AdminUser({ params }: { params: Promise<{ id: string }> }) {
  const me = await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [u] = await db().select().from(schema.users).where(eq(schema.users.id, id)).limit(1);
  if (!u) notFound();

  const [devices, grants, tokens] = await Promise.all([
    db().select().from(schema.devices).where(and(eq(schema.devices.userId, id), isNull(schema.devices.revokedAt))),
    db().select().from(schema.clientGrants).where(and(eq(schema.clientGrants.userId, id), isNull(schema.clientGrants.revokedAt))),
    db().select().from(schema.accessTokens).where(and(eq(schema.accessTokens.userId, id), isNull(schema.accessTokens.revokedAt))).orderBy(desc(schema.accessTokens.createdAt)),
  ]);
  const devName = new Map(devices.map((d) => [d.id, d.name]));
  const revoke = (kind: string, rid: string, label = "Revogar") => (
    <form action={adminRevoke} style={{ display: "inline" }}>
      <input type="hidden" name="kind" value={kind} /><input type="hidden" name="id" value={rid} />
      <input type="hidden" name="userId" value={id} /><button>{label}</button>
    </form>
  );

  return (
    <main style={{ maxWidth: 900 }}>
      <h1>{u.email}</h1>
      <p>{u.name} · papel <strong>{u.role}</strong> · estado <strong>{u.status}</strong> · criado {when(u.createdAt)}</p>

      {u.id !== me.id && (
        <form action={setRole}>
          <input type="hidden" name="userId" value={u.id} />
          {u.role === "user"
            ? <button name="role" value="admin" disabled={u.status !== "active"}>Promover a admin</button>
            : <button name="role" value="user">Despromover a utilizador</button>}
        </form>
      )}

      <h2>Limites (teto)</h2>
      <p>Nenhum grant deste utilizador pode exceder o teto; aplica-se também aos acessos já concedidos.</p>
      <PanelForm action={setLimits} submit="Guardar limites">
        <input type="hidden" name="userId" value={u.id} />
        <label>Preset máximo{" "}
          <select name="maxPreset" defaultValue={u.maxPreset}>
            <option value="read_only">Só leitura</option><option value="read_write">Leitura e escrita</option><option value="terminal">Terminal</option>
          </select>
        </label>
        <label>Máx. dispositivos <input name="maxDevices" type="number" min={0} max={100} defaultValue={u.maxDevices} /></label>
        <fieldset>
          <legend>Tools proibidas</legend>
          {ALL_TOOLS.map((t) => (
            <label key={t} style={{ display: "inline-block", marginRight: 12 }}>
              <input type="checkbox" name="disabled" value={t} defaultChecked={u.disabledTools.includes(t)} /> <code>{t}</code>
            </label>
          ))}
        </fieldset>
      </PanelForm>

      <h2>Dispositivos</h2>
      <ul>{devices.map((d) => <li key={d.id}>{d.name} ({d.os ?? "?"}) {d.enabled ? "" : "· desativado"} {revoke("device", d.id)}</li>)}</ul>
      <h2>Grants ativos</h2>
      <ul>{grants.map((g) => <li key={g.id}>{devName.get(g.deviceId) ?? "?"} — {g.preset} — cliente {g.clientId.slice(0, 12)}… {revoke("grant", g.id)}</li>)}</ul>
      <h2>Tokens</h2>
      <ul>{tokens.map((t) => <li key={t.id}>{t.name ?? t.kind} ({t.kind}) último uso {when(t.lastUsedAt)} {revoke("token", t.id)}</li>)}</ul>

      <h2>Ações</h2>
      <form action={revokeAllForUser} style={{ display: "inline" }}>
        <input type="hidden" name="userId" value={u.id} /><button>Revogar tudo (grants e tokens)</button>
      </form>{" "}
      {u.id !== me.id && u.role !== "admin" && (
        <form action={deleteUser} style={{ display: "inline" }}>
          <input type="hidden" name="userId" value={u.id} /><button>Apagar utilizador</button>
        </form>
      )}
      <p><a href="/admin">Voltar</a></p>
    </main>
  );
}
