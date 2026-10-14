import { and, eq, isNull } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { checkCeiling } from "@mortality/shared";
import { appUrl } from "@/lib/app-url";
import { db, schema } from "@/lib/db";
import { redirectWith, validateAuthRequest } from "@/lib/oauth-request";
import { currentUser } from "@/lib/session";
import { ConsentForm, type PresetOption } from "./consent-form";

type SP = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null;
const KEYS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "scope", "resource"];

const PRESETS: PresetOption[] = [
  { value: "read_only", label: "Só leitura", summary: "Listar, ler e pesquisar ficheiros e ver informação do sistema. Não altera nada." },
  { value: "read_write", label: "Leitura e escrita", summary: "Tudo o anterior, mais escrever, editar, criar pastas e mover ficheiros." },
  { value: "terminal", label: "Terminal", summary: "Tudo o anterior, mais executar comandos. Cada comando espera a tua aprovação no painel." },
  { value: "sudo_for_all", label: "sudo-for-all", summary: "Todas as ferramentas e o terminal, sem pedir permissão." },
];

export default async function Authorize({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  if (first(sp.error)) return <Fatal message={first(sp.error)!} />;

  const base = appUrl();
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
  const url = new URL(req.redirectUri);
  const host = url.host || url.protocol;

  // Só oferece os presets que o teto do administrador permite.
  const presets = PRESETS.filter((p) => !checkCeiling(user, { preset: p.value }));
  const params: Record<string, string> = {};
  for (const k of KEYS) { const v = first(sp[k]); if (v !== null) params[k] = v; }

  const err = first(sp.form_error);
  const deviceIds = new Set(devices.map((d) => d.id));

  return (
    <main>
      <h1>Autorizar {req.clientName}</h1>
      <p>
        Esta aplicação pede acesso às tuas máquinas através da conta <strong>{user.email}</strong>.
        Depois da decisão volta para <code>{host}</code>.
      </p>
      <p className="muted">
        Só autorizes se foste tu a iniciar esta ligação. Sem dispositivos escolhidos, o acesso fica negado, e podes
        revogá-lo a qualquer momento em <Link href="/clients">Clientes</Link>.
      </p>

      {devices.length === 0 ? (
        <div className="empty">
          <strong>Ainda não tens dispositivos.</strong> Num terminal do computador que queres ligar:
          <pre>{`curl -fsSL ${base}/install | bash`}</pre>
          Depois emparelha-o em <Link href="/device">Emparelhar dispositivo</Link> e volta a abrir esta ligação.
        </div>
      ) : presets.length === 0 ? (
        <div className="empty">O administrador não permite nenhum nível de acesso para a tua conta.</div>
      ) : (
        <ConsentForm
          params={params}
          devices={devices.map((d) => ({ id: d.id, name: d.name, os: d.os }))}
          presets={presets}
          allowAllOk={user.allowAllDirsOk}
          error={err ? err.slice(0, 240) : null}
          defaults={{
            preset: first(sp.preset) ?? "read_only",
            duration: first(sp.duration) ?? "24h",
            devices: (first(sp.devices) ?? "").split(",").filter((id) => deviceIds.has(id)),
            allowAll: first(sp.allowAll) === "1",
            dirs: (first(sp.dirs) ?? "").slice(0, 2000),
            blockedDirs: (first(sp.blockedDirs) ?? "").slice(0, 2000),
          }}
        />
      )}
    </main>
  );
}

function Fatal({ message }: { message: string }) {
  return (
    <main className="narrow">
      <h1>Pedido inválido</h1>
      <p className="alert">{message}</p>
      <p className="muted">Volta à aplicação que iniciou o pedido e tenta de novo.</p>
    </main>
  );
}
