import { and, eq, isNull } from "drizzle-orm";
import { redirect } from "next/navigation";
import { decideConsent } from "@/lib/oauth-actions";
import { db, schema } from "@/lib/db";
import { currentUser } from "@/lib/session";
import { validateAuthRequest, redirectWith } from "@/lib/oauth-request";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const KEYS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "scope", "resource"];

export default async function Authorize({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  if (first(sp.error)) return <Fatal message={first(sp.error)!} />;

  const base = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const req = await validateAuthRequest((k) => first(sp[k]), base);
  if (req.kind === "fatal") return <Fatal message={req.message} />;
  if (req.kind === "redirect_error") redirect(redirectWith(req.redirectUri, { error: req.error, state: req.state }, base));

  const user = await currentUser();
  if (!user || user.status !== "active") {
    const q = new URLSearchParams();
    for (const k of KEYS) { const v = first(sp[k]); if (v !== null) q.set(k, v); }
    redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${q}`)}`);
  }
  if (user.mustChangePassword) redirect("/change-password");

  const devices = await db().select().from(schema.devices)
    .where(and(eq(schema.devices.userId, user.id), isNull(schema.devices.revokedAt)));
  const host = new URL(req.redirectUri).host || new URL(req.redirectUri).protocol;

  return (
    <main>
      <h1>Autorizar acesso</h1>
      <p><strong>{req.clientName}</strong> (devolve para <code>{host}</code>) quer aceder à tua conta <strong>{user.email}</strong>.</p>
      <p>Sem escolher dispositivos, o acesso fica negado. Podes revogar a qualquer momento em <em>Clientes ligados</em>.</p>
      {first(sp.form_error) && <p role="alert" style={{ color: "crimson" }}>Escolhe pelo menos um dispositivo e indica diretórios absolutos permitidos.</p>}
      {devices.length === 0 ? (
        <p>Não tens dispositivos emparelhados. <a href="/device">Emparelha um</a> e volta a tentar.</p>
      ) : (
        <form action={decideConsent} style={{ display: "grid", gap: 12 }}>
          {KEYS.map((k) => first(sp[k]) !== null && <input key={k} type="hidden" name={k} value={first(sp[k])!} />)}
          <fieldset>
            <legend>Dispositivos</legend>
            {devices.map((d) => (
              <label key={d.id} style={{ display: "block" }}>
                <input type="checkbox" name="devices" value={d.id} /> {d.name} <small>({d.os ?? "?"})</small>
              </label>
            ))}
          </fieldset>
          <label>Permissões{" "}
            <select name="preset" defaultValue="read_only">
              <option value="read_only">Só leitura (listar, ler, pesquisar, info)</option>
              <option value="read_write">Leitura e escrita</option>
              <option value="terminal">Terminal (processos; recomenda aprovação humana)</option>
            </select>
          </label>
          <label>Duração{" "}
            <select name="duration" defaultValue="24h">
              <option value="1h">1 hora</option><option value="24h">24 horas</option>
              <option value="30d">30 dias</option><option value="never">Até revogar</option>
            </select>
          </label>
          <label>Diretórios permitidos (um por linha)
            <textarea name="dirs" rows={3} required style={{ width: "100%" }} placeholder="/home/user/projeto" />
          </label>
          <div>
            <button name="decision" value="approve">Autorizar</button>{" "}
            <button name="decision" value="deny" formNoValidate>Negar</button>
          </div>
        </form>
      )}
    </main>
  );
}

function Fatal({ message }: { message: string }) {
  return <main><h1>Pedido inválido</h1><p>{message}</p></main>;
}
