import { ALL_TOOLS } from "@mortality/shared";
import { DirFields } from "./dir-fields";

export const APPROVAL_TOOLS = ["start_process", "interact_with_process", "write_file", "edit_block", "move_file", "terminate_session"];

/** Aviso e confirmação do preset sudo-for-all (só é exigida quando esse preset está escolhido). */
export function SudoConfirm() {
  return (
    <fieldset>
      <legend>Só para sudo-for-all</legend>
      <p className="alert">
        Dá <strong>todas as ferramentas e o terminal, sem pedir permissão</strong>. O cliente pode ler, escrever e executar
        qualquer coisa que o utilizador do relay possa. Dura no máximo 24 horas. Diretórios e comandos bloqueados continuam a valer.
      </p>
      <label><input type="checkbox" name="confirmSudo" /> Compreendo e quero dar acesso total a este cliente</label>
    </fieldset>
  );
}

export interface GrantDefaults {
  preset?: string; dirs?: string[]; blockedDirs?: string[]; allowAll?: boolean; blocked?: string[]; readOnly?: boolean; tools?: string[]; approve?: string[];
}

/** Campos partilhados entre "editar grant" e "dar acesso". */
export function GrantFields({ d = {}, keepDuration, allowAllOk = true }: { d?: GrantDefaults; keepDuration?: boolean; allowAllOk?: boolean }) {
  return (
    <>
      <label>Preset{" "}
        <select name="preset" defaultValue={d.preset ?? "read_only"}>
          <option value="read_only">Só leitura</option>
          <option value="read_write">Leitura e escrita</option>
          <option value="terminal">Terminal</option>
          <option value="sudo_for_all">sudo-for-all (acesso total)</option>
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
      <DirFields dirs={d.dirs} blocked={d.blockedDirs} allowAll={d.allowAll} allowAllOk={allowAllOk} />
      <label>Comandos bloqueados (um por linha; guardrail, não sandbox)
        <textarea name="blocked" rows={2} defaultValue={(d.blocked ?? []).join("\n")} />
      </label>
      <label><input type="checkbox" name="readOnly" defaultChecked={d.readOnly} /> Forçar só leitura</label>
      <fieldset>
        <legend>Exigir aprovação humana no painel para</legend>
        {APPROVAL_TOOLS.map((t) => (
          <label key={t}>
            <input type="checkbox" name="approve" value={t} defaultChecked={d.approve?.includes(t)} /> <code>{t}</code>
          </label>
        ))}
      </fieldset>
      <SudoConfirm />
      <details>
        <summary>Tools (só usadas no preset Personalizado)</summary>
        {ALL_TOOLS.map((t) => (
          <label key={t}>
            <input type="checkbox" name="tools" value={t} defaultChecked={d.tools?.includes(t)} /> {t}
          </label>
        ))}
      </details>
    </>
  );
}
