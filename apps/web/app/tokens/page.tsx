import { and, desc, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/guard";
import { createPat, revokePat } from "@/lib/panel-actions";
import { PanelForm } from "../panel-form";

export default async function Tokens() {
  const user = await requireUser();
  const devices = await db().select().from(schema.devices)
    .where(and(eq(schema.devices.userId, user.id), isNull(schema.devices.revokedAt)));
  const pats = await db().select().from(schema.accessTokens)
    .where(and(eq(schema.accessTokens.userId, user.id), eq(schema.accessTokens.kind, "pat"), isNull(schema.accessTokens.revokedAt)))
    .orderBy(desc(schema.accessTokens.createdAt));
  return (
    <main>
      <h1>Tokens de acesso (PAT)</h1>
      <p>Cada token nasce sem acesso; aqui defines já o dispositivo, o preset e os diretórios permitidos.</p>
      {devices.length === 0 ? <p>Emparelha primeiro um dispositivo.</p> : (
        <PanelForm action={createPat} submit="Criar token">
          <input name="name" placeholder="Nome (ex.: Claude Code)" required maxLength={60} />
          <select name="deviceId" required>{devices.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
          <select name="preset" defaultValue="read_only">
            <option value="read_only">Só leitura</option>
            <option value="read_write">Leitura e escrita</option>
            <option value="terminal">Terminal</option>
          </select>
          <select name="duration" defaultValue="24h">
            <option value="1h">1 hora</option><option value="24h">24 horas</option>
            <option value="30d">30 dias</option><option value="never">Até revogar</option>
          </select>
          <textarea name="dirs" rows={3} placeholder={"Diretórios permitidos (um por linha)\n/home/user/projeto"} required />
        </PanelForm>
      )}
      <h2>Ativos</h2>
      <ul>
        {pats.map((t) => (
          <li key={t.id}>
            {t.name} — {t.expiresAt ? `expira ${t.expiresAt.toISOString().slice(0, 16)}` : "sem expiração"}{" "}
            <form action={revokePat} style={{ display: "inline" }}>
              <input type="hidden" name="id" value={t.id} /><button>Revogar</button>
            </form>
          </li>
        ))}
      </ul>
      <p><a href="/dashboard">Voltar</a></p>
    </main>
  );
}
