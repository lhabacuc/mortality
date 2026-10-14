import { SUDO_MAX_SECONDS, SUDO_PRESET } from "@mortality/shared";

const SECONDS: Record<string, number | null> = { "1h": 3600, "24h": 86400, "30d": 2592000, never: null, keep: null };

/** Regras extra do preset sudo-for-all; devolve texto de erro ou null. */
export function checkSudo(preset: string, duration: string, form: FormData): string | null {
  if (preset !== SUDO_PRESET) return null;
  if (form.get("confirmSudo") !== "on") return "Confirma que compreendes o que o sudo-for-all permite.";
  // «manter» herdaria a expiração anterior (possivelmente 30 dias): exige escolha explícita.
  const d = SECONDS[duration];
  if (duration === "keep" || d === null || d === undefined || d > SUDO_MAX_SECONDS) {
    return "O sudo-for-all dura no máximo 24 horas. Escolhe 1 hora ou 24 horas.";
  }
  return null;
}
