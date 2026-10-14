/** "há 5 min", "há 2 h", "agora"; null → fallback. */
export function ago(d: Date | null | undefined, fallback = "nunca"): string {
  if (!d) return fallback;
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 10) return "agora";
  if (s < 60) return `há ${s} s`;
  if (s < 3600) return `há ${Math.round(s / 60)} min`;
  if (s < 86400) return `há ${Math.round(s / 3600)} h`;
  return `há ${Math.round(s / 86400)} d`;
}

/** "daqui a 5 min" / "expirado"; null → "sem expiração". */
export function until(d: Date | null | undefined): string {
  if (!d) return "sem expiração";
  const s = Math.round((d.getTime() - Date.now()) / 1000);
  if (s <= 0) return "expirado";
  if (s < 3600) return `expira em ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 86400) return `expira em ${Math.round(s / 3600)} h`;
  return `expira em ${Math.round(s / 86400)} d`;
}

const ACTIONS: Record<string, string> = {
  "tool.call": "Chamada executada",
  "tool.denied": "Chamada negada",
  "approval.granted": "Aprovação concedida",
  "approval.denied": "Aprovação negada",
  "device.pair": "Dispositivo emparelhado",
  "device.pair_denied": "Emparelhamento recusado",
  "device.enable": "Dispositivo ativado",
  "device.disable": "Dispositivo desativado",
  "device.revoke": "Dispositivo removido",
  "device.self_revoke": "Dispositivo desinstalado",
  "grant.create": "Acesso concedido",
  "grant.update": "Acesso alterado",
  "grant.revoke": "Acesso revogado",
  "pat.create": "Token criado",
  "pat.revoke": "Token revogado",
  "oauth.consent": "Cliente autorizado",
  "oauth_client.revoke": "Cliente revogado",
  "disconnect_all": "Tudo desconectado",
  "totp.enabled": "2FA ativado",
  "totp.disabled": "2FA desativado",
  "totp.failed": "Código 2FA inválido",
  "totp.recovery_used": "Código de recuperação usado",
};

/** Nome legível de uma ação do audit; desconhecidas mantêm o identificador. */
export const actionLabel = (a: string) => ACTIONS[a] ?? a;

/** 45 → "45 s"; 599 → "9 min 59 s". */
export function countdown(sec: number): string {
  if (sec < 90) return `${sec} s`;
  return `${Math.floor(sec / 60)} min ${String(sec % 60).padStart(2, "0")} s`;
}
