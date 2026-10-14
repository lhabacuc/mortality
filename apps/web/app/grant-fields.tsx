import { ALL_TOOLS } from "@mortality/shared";

export interface GrantDefaults {
  preset?: string; dirs?: string[]; blocked?: string[]; readOnly?: boolean; tools?: string[]; approveProcess?: boolean;
}

/** Campos partilhados entre "editar grant" e "dar acesso". */
export function GrantFields({ d = {}, keepDuration }: { d?: GrantDefaults; keepDuration?: boolean }) {
  return (
    <>
      <label>Preset{" "}
        <select name="preset" defaultValue={d.preset ?? "read_only"}>
          <option value="read_only">Só leitura</option>
          <option value="read_write">Leitura e escrita</option>
          <option value="terminal">Terminal</option>
          <option value="custom">Personalizado</option>
        </select>
      </label>
      <label>Duração{" "}
        <select name="duration" defaultValue={keepDuration ? "keep" : "24h"}>
          {keepDuration && <option value="keep">Manter expiração atual</option>}
          <option value="1h">1 hora</option><option value="24h">24 horas</option>
          <option value="30d">30 dias</option><option value="never">Até revogar</option>
        </select>
      </label>
      <label>Diretórios permitidos (um por linha)
        <textarea name="dirs" rows={3} defaultValue={(d.dirs ?? []).join("\n")} required style={{ width: "100%" }} />
      </label>
      <label>Comandos bloqueados (um por linha; guardrail, não sandbox)
        <textarea name="blocked" rows={2} defaultValue={(d.blocked ?? []).join("\n")} style={{ width: "100%" }} />
      </label>
      <label><input type="checkbox" name="readOnly" defaultChecked={d.readOnly} /> Forçar só leitura</label>
      <label><input type="checkbox" name="approveProcess" defaultChecked={d.approveProcess} /> Exigir aprovação humana para <code>start_process</code> (até à Fase 6 a tool fica negada)</label>
      <details>
        <summary>Tools (só usadas no preset Personalizado)</summary>
        {ALL_TOOLS.map((t) => (
          <label key={t} style={{ display: "block" }}>
            <input type="checkbox" name="tools" value={t} defaultChecked={d.tools?.includes(t)} /> {t}
          </label>
        ))}
      </details>
    </>
  );
}
