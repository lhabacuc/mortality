import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { requireUser } from "@/lib/guard";
import { decideDevice, resolveDeviceCode } from "@/lib/panel-actions";
import { PanelForm } from "../panel-form";

export default async function DevicePage({ searchParams }: { searchParams: Promise<{ code?: string; error?: string }> }) {
  await requireUser();
  const { code, error } = await searchParams;
  const [dc] = code
    ? await db().select().from(schema.deviceCodes).where(eq(schema.deviceCodes.userCode, code.toUpperCase())).limit(1)
    : [];
  const valid = dc && dc.status === "pending" && dc.expiresAt > new Date();

  return (
    <main>
      <h1>Emparelhar dispositivo</h1>
      {error === "expired" && <p role="alert" className="alert">Código expirado ou já usado.</p>}
      {error === "limit" && <p role="alert" className="alert">Atingiste o limite de dispositivos definido pelo administrador.</p>}
      {error === "name" && <p role="alert" className="alert">Já tens um dispositivo com esse nome.</p>}
      {valid ? (
        <form action={decideDevice} className="stack">
          <p>Um dispositivo <strong>{dc.os ?? "desconhecido"}</strong> pede acesso à tua conta com o código <code>{dc.userCode}</code>.</p>
          <p>Só aprova se foste tu a correr <code>mortality install</code> e o código coincide com o do terminal.</p>
          <input type="hidden" name="code" value={dc.userCode} />
          <label>Nome do dispositivo <input name="name" defaultValue={dc.deviceName ?? ""} required maxLength={60} /></label>
          <div className="row">
            <button name="decision" value="approve" className="primary">Aprovar</button>
            <button name="decision" value="deny">Negar</button>
          </div>
        </form>
      ) : (
        <PanelForm action={resolveDeviceCode} submit="Continuar">
          <input name="code" aria-label="Código do dispositivo" placeholder="XXXX-XXXX" required maxLength={9} autoComplete="off" />
        </PanelForm>
      )}
          </main>
  );
}
