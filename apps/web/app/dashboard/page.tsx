import Link from "next/link";
import { and, count, desc, eq, gt, isNull } from "drizzle-orm";
import { ONLINE_THRESHOLD_MS } from "@mortality/shared";
import { db, schema } from "@/lib/db";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/session";
import { appUrl } from "@/lib/app-url";
import { actionLabel, ago } from "@/lib/format";

export default async function Dashboard() {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) redirect("/change-password");
  if (user.status !== "active") redirect("/login");

  const now = new Date();
  const [devices, [{ n: grants }], [{ n: pending }], recent] = await Promise.all([
    db().select().from(schema.devices).where(and(eq(schema.devices.userId, user.id), isNull(schema.devices.revokedAt))),
    db().select({ n: count() }).from(schema.clientGrants).where(and(
      eq(schema.clientGrants.userId, user.id), isNull(schema.clientGrants.revokedAt))),
    db().select({ n: count() }).from(schema.jobs).where(and(
      eq(schema.jobs.userId, user.id), eq(schema.jobs.status, "awaiting_approval"), gt(schema.jobs.expiresAt, now))),
    db().select({ a: schema.auditLog.action, t: schema.auditLog.tool, ok: schema.auditLog.ok, at: schema.auditLog.createdAt })
      .from(schema.auditLog).where(eq(schema.auditLog.userId, user.id)).orderBy(desc(schema.auditLog.createdAt)).limit(5),
  ]);
  const online = devices.filter((d) => d.enabled && !d.pausedLocally && d.lastSeenAt && now.getTime() - d.lastSeenAt.getTime() < ONLINE_THRESHOLD_MS).length;

  return (
    <main>
      <h1>Olá, {user.name}</h1>
      <p className="muted">Tudo o que um cliente de IA pode fazer nas tuas máquinas é decidido aqui.</p>

      <div className="stats">
        <Link href="/devices" className="stat"><b>{online}/{devices.length}</b><span>dispositivos online</span></Link>
        <Link href="/clients" className="stat"><b>{grants}</b><span>acessos concedidos</span></Link>
        <Link href="/approvals" className={`stat${pending > 0 ? " warn" : ""}`}><b>{pending}</b><span>{pending === 1 ? "aprovação pendente" : "aprovações pendentes"}</span></Link>
      </div>

      {devices.length === 0 && (
        <div className="empty">
          <strong>Começa por ligar um computador.</strong>
          <ol>
            <li>Num terminal do computador: <code>curl -fsSL {appUrl()}/install | bash</code> (<Link href="/guide">ver guia</Link>).</li>
            <li>Confirma o código em <Link href="/device">Emparelhar dispositivo</Link>.</li>
          </ol>
        </div>
      )}
      {devices.length > 0 && grants === 0 && (
        <div className="empty">
          <strong>Nenhum cliente tem acesso ainda.</strong> Liga o ChatGPT, o Claude ou outro em <Link href="/connect">Ligar</Link>,
          ou cria um <Link href="/tokens">token</Link>.
        </div>
      )}

      <h2>Atividade recente</h2>
      {recent.length === 0 ? <p className="muted">Sem atividade ainda.</p> : (
        <div className="table-wrap">
          <table>
            <tbody>
              {recent.map((r, i) => (
                <tr key={i}>
                  <td><span className={`dot ${r.ok ? "ok" : "bad"}`} />{actionLabel(r.a)}{r.t ? <> · <span className="mono">{r.t}</span></> : null}</td>
                  <td className="act muted">{ago(r.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p><Link href="/activity">Ver tudo</Link>{user.role === "admin" && <> · <Link href="/admin">Administração</Link></>}</p>
    </main>
  );
}
