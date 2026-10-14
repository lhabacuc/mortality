"use client";

import { useState } from "react";
import { decideConsent } from "@/lib/oauth-actions";

export interface PresetOption { value: string; label: string; summary: string }
export interface DeviceOption { id: string; name: string; os: string | null }
export interface Defaults { preset: string; duration: string; devices: string[]; allowAll: boolean; dirs: string; blockedDirs: string }

const DURATIONS: [string, string][] = [["1h", "1 hora"], ["24h", "24 horas"], ["30d", "30 dias"], ["never", "Até revogar"]];

/** Ecrã de consentimento: o formulário adapta-se ao preset (duração máxima, confirmação do sudo). */
export function ConsentForm({ params, devices, presets, allowAllOk, defaults, error }: {
  params: Record<string, string>;
  devices: DeviceOption[];
  presets: PresetOption[];
  allowAllOk: boolean;
  defaults: Defaults;
  error: string | null;
}) {
  const [preset, setPreset] = useState(presets.some((p) => p.value === defaults.preset) ? defaults.preset : presets[0].value);
  const [duration, setDuration] = useState(defaults.duration);
  const [all, setAll] = useState(defaults.allowAll && allowAllOk);
  const sudo = preset === "sudo_for_all";
  const current = presets.find((p) => p.value === preset)!;
  const durationOk = (v: string) => !sudo || v === "1h" || v === "24h";
  const effectiveDuration = durationOk(duration) ? duration : "24h";

  return (
    <form action={decideConsent} className="stack">
      {Object.entries(params).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {error && <p role="alert" className="alert">{error}</p>}

      <fieldset>
        <legend>Dispositivos a que este cliente pode aceder</legend>
        {devices.map((d) => (
          <label key={d.id}>
            <input type="checkbox" name="devices" value={d.id} defaultChecked={defaults.devices.includes(d.id)} />
            <span>{d.name} <small className="muted">{d.os ?? ""}</small></span>
          </label>
        ))}
      </fieldset>

      <label>Permissões
        <select name="preset" value={preset} onChange={(e) => setPreset(e.target.value)}>
          {presets.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <small className={sudo ? "alert" : "muted"}>{current.summary}</small>
      </label>

      <label>Duração
        <select name="duration" value={effectiveDuration} onChange={(e) => setDuration(e.target.value)}>
          {DURATIONS.map(([v, l]) => <option key={v} value={v} disabled={!durationOk(v)}>{l}{!durationOk(v) ? " (indisponível no sudo-for-all)" : ""}</option>)}
        </select>
      </label>

      {allowAllOk && (
        <label>
          <input type="checkbox" name="allowAll" checked={all} onChange={(e) => setAll(e.target.checked)} />
          <span>Permitir <strong>todos os diretórios</strong></span>
        </label>
      )}
      {all ? (
        <p className="notice">
          Qualquer pasta que o utilizador do relay alcance. O dispositivo continua a limitar localmente
          (<code>mortality policy allow-all on</code>) e os diretórios bloqueados prevalecem.
        </p>
      ) : (
        <label>Diretórios permitidos (um por linha)
          <textarea name="dirs" rows={3} defaultValue={defaults.dirs} placeholder="/home/user/projeto" />
        </label>
      )}
      <label>Diretórios bloqueados (um por linha; prevalecem sobre tudo)
        <textarea name="blockedDirs" rows={2} defaultValue={defaults.blockedDirs} placeholder="/home/user/.ssh" />
      </label>

      {sudo && (
        <div className="notice">
          <p style={{ margin: "0 0 8px" }}>
            <strong>Acesso total sem pedir permissão.</strong> O cliente pode ler, escrever e executar o que o utilizador do
            relay puder, durante no máximo 24 horas.
          </p>
          <label><input type="checkbox" name="confirmSudo" /> <span>Compreendo e quero dar acesso total a este cliente</span></label>
        </div>
      )}

      <div className="row">
        <button name="decision" value="approve" className="primary">Autorizar</button>
        <button name="decision" value="deny" formNoValidate>Negar</button>
      </div>
    </form>
  );
}
