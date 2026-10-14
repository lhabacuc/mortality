import { z } from "zod";

export const Role = z.enum(["admin", "user"]);
export const UserStatus = z.enum(["pending", "active", "suspended"]);
export const SignupMode = z.enum(["open", "approval", "invite_only"]);
export type Role = z.infer<typeof Role>;
export type UserStatus = z.infer<typeof UserStatus>;

// ── Permissões ────────────────────────────────────────────────────────────
export const Preset = z.enum(["read_only", "read_write", "terminal", "sudo_for_all", "custom"]);
export type Preset = z.infer<typeof Preset>;

const READ = ["list_devices", "whoami", "ping_device", "read_file", "read_multiple_files",
  "list_directory", "get_file_info", "start_search", "get_search_results", "stop_search",
  "get_system_info", "list_system_processes"] as const;
const WRITE = ["write_file", "edit_block", "create_directory", "move_file"] as const;
const TERMINAL = ["start_process", "interact_with_process", "read_process_output",
  "list_sessions", "terminate_session"] as const;

export const ALL_TOOLS: string[] = [...READ, ...WRITE, ...TERMINAL];
/** Tools que correm no relay (as restantes são resolvidas no servidor). */
export const SERVER_SIDE_TOOLS = ["list_devices", "whoami"] as const;

export function toolsForPreset(preset: Preset): string[] {
  switch (preset) {
    case "read_only": return [...READ];
    case "read_write": return [...READ, ...WRITE];
    case "terminal": return [...READ, ...WRITE, ...TERMINAL];
    // Acesso total: todas as tools, sem aprovações (ver SUDO_PRESET em activeGrants).
    case "sudo_for_all": return [...ALL_TOOLS];
    default: return [];
  }
}

/** Permissões efetivas enviadas dentro de cada job; o relay revalida e cruza com a política local. */
export interface EffectivePermissions {
  allowedDirs: string[];
  /** Diretórios sempre vedados; prevalecem sobre `allowedDirs` e `allowAllDirs`. */
  blockedDirs: string[];
  /** Todos os diretórios (ainda limitado pela política local do dispositivo). */
  allowAllDirs: boolean;
  blockedCommands: string[];
  readOnly: boolean;
}

export interface RelayJob {
  id: string;
  clientId: string;
  tool: string;
  args: Record<string, unknown>;
  permissions: EffectivePermissions;
  timeoutSeconds: number;
}

export const RELAY_PROTOCOL = 1;
export const ONLINE_THRESHOLD_MS = 45_000;

/** Verificação lexical (posix/windows); o relay faz ainda `realpath` antes de aceitar. */
export function isWithin(base: string, target: string): boolean {
  const norm = (p: string) => {
    const win = /^[a-zA-Z]:[\\/]/.test(p) || p.includes("\\");
    const parts: string[] = [];
    for (const seg of p.replace(/\\/g, "/").split("/")) {
      if (seg === "" || seg === ".") continue;
      if (seg === "..") parts.pop(); else parts.push(win ? seg.toLowerCase() : seg);
    }
    return "/" + parts.join("/");
  };
  if (!base || !target) return false;
  const b = norm(base), t = norm(target);
  return t === b || t.startsWith(b === "/" ? "/" : b + "/");
}

const WRAPPERS = new Set(["sudo", "env", "nohup", "command", "exec", "time", "nice", "xargs"]);

/** Guardrail (NÃO é sandbox). Mantém-se idêntica à do relay (packages/cli/src/policy.ts). */
export function commandBlocked(command: string, blocked: string[]): string | null {
  const entries = blocked.map((b) => b.trim().toLowerCase()).filter(Boolean);
  if (!entries.length) return null;
  for (const seg of command.split(/&&|\|\||\$\(|[;|&\n`()]/)) {
    let words = seg.trim().toLowerCase().split(/\s+/).filter(Boolean);
    while (words.length && (/^\w+=/.test(words[0]) || WRAPPERS.has(words[0]))) words = words.slice(1);
    if (!words.length) continue;
    const first = words[0].split("/").pop()!;
    const joined = [first, ...words.slice(1)].join(" ");
    for (const e of entries) {
      if (e.includes(" ") ? joined === e || joined.startsWith(e + " ") : first === e) return e;
    }
  }
  return null;
}

export const PRESET_ORDER = ["read_only", "read_write", "terminal", "sudo_for_all"] as const;
export const SUDO_PRESET = "sudo_for_all";
/** Duração máxima (segundos) de um grant sudo-for-all. */
export const SUDO_MAX_SECONDS = 24 * 3600;
export type CeilingPreset = (typeof PRESET_ORDER)[number];
export const presetRank = (p: string) => PRESET_ORDER.indexOf(p as CeilingPreset);

/** Tools que o teto do utilizador permite (preset máximo menos tools proibidas). */
export function ceilingTools(maxPreset: string, disabledTools: string[]): string[] {
  const allowed = toolsForPreset((PRESET_ORDER.includes(maxPreset as CeilingPreset) ? maxPreset : "read_only") as Preset);
  return allowed.filter((t) => !disabledTools.includes(t));
}

/** Erro (texto) se o grant pedido excede o teto; senão null. */
export function checkCeiling(
  ceiling: { maxPreset: string; disabledTools: string[] },
  want: { preset: string; tools?: string[] },
): string | null {
  const cap = ceilingTools(ceiling.maxPreset, ceiling.disabledTools);
  if (want.preset === "custom") {
    const bad = (want.tools ?? []).filter((t) => !cap.includes(t));
    return bad.length ? `Tools acima do teu limite: ${bad.join(", ")}.` : null;
  }
  if (presetRank(want.preset) > presetRank(ceiling.maxPreset)) {
    return `O teu limite máximo é "${ceiling.maxPreset}".`;
  }
  const over = toolsForPreset(want.preset as Preset).filter((t) => !cap.includes(t));
  return over.length ? `Este preset inclui tools proibidas para a tua conta: ${over.join(", ")}.` : null;
}

/** Verificação lexical (servidor): bloqueio vence; depois `allowAllDirs` ou `allowedDirs`. */
export function pathAllowed(
  perms: Pick<EffectivePermissions, "allowedDirs" | "blockedDirs" | "allowAllDirs">,
  path: string,
): { ok: true } | { ok: false; reason: "blocked" | "outside" } {
  if (perms.blockedDirs.some((d) => isWithin(d, path))) return { ok: false, reason: "blocked" };
  if (perms.allowAllDirs || perms.allowedDirs.some((d) => isWithin(d, path))) return { ok: true };
  return { ok: false, reason: "outside" };
}

/** "0.3.1" >= "0.3.0"; versões ausentes ou inválidas contam como antigas. */
export function versionAtLeast(v: string | null | undefined, min: string): boolean {
  const p = (s: string) => s.split(".").map((n) => parseInt(n, 10));
  const a = v ? p(v) : null;
  if (!a || a.some(Number.isNaN)) return false;
  const b = p(min);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

/** Versão mínima do relay que impõe `blockedDirs` (relays antigos ignoravam o campo). */
export const MIN_RELAY_BLOCKED_DIRS = "0.3.0";
