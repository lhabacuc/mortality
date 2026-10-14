import { existsSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { policyPath, ensureConfigDir } from "./config.ts";

export interface Policy {
  allowed_dirs: string[];
  blocked_commands: string[];
  read_only: boolean;
  max_sessions: number;
  max_output_bytes: number;
  max_job_seconds: number;
}

export interface JobPermissions { allowedDirs: string[]; blockedCommands: string[]; readOnly: boolean }

export const defaultPolicy = (dir: string): Policy => ({
  allowed_dirs: [dir], blocked_commands: [], read_only: false,
  max_sessions: 5, max_output_bytes: 1_000_000, max_job_seconds: 50,
});

export function loadPolicy(): Policy {
  // Sem política válida → falha fechada (nada permitido).
  const closed = { ...defaultPolicy(""), allowed_dirs: [] };
  if (!existsSync(policyPath())) return closed;
  try { return { ...closed, ...JSON.parse(readFileSync(policyPath(), "utf8")) }; } catch { return closed; }
}

export function savePolicy(p: Policy) {
  ensureConfigDir();
  writeFileSync(policyPath(), JSON.stringify(p, null, 2), { mode: 0o600 });
}

/** realpath do caminho; se não existir, do ancestral existente + resto (para escritas futuras). */
export function realResolve(p: string): string {
  let cur = resolve(p);
  const rest: string[] = [];
  for (;;) {
    try { return join(realpathSync(cur), ...rest.reverse()); } catch {
      const parent = dirname(cur);
      if (parent === cur) return resolve(p);
      rest.push(cur.slice(parent.length).replace(/^[\\/]+/, ""));
      cur = parent;
    }
  }
}

export function within(base: string, target: string): boolean {
  const rel = relative(base, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Permissões efetivas = interseção servidor ∩ política local: tem de caber nas DUAS listas. */
export function checkPath(target: string, perms: JobPermissions, policy: Policy): string {
  if (!isAbsolute(target)) throw new Error("Caminho tem de ser absoluto.");
  const real = realResolve(target);
  const ok = (dirs: string[]) => dirs.some((d) => d && within(realResolve(d), real));
  if (!ok(perms.allowedDirs)) throw new Error("Caminho fora dos diretórios permitidos pelo servidor.");
  if (!ok(policy.allowed_dirs)) throw new Error("Caminho fora da política local.");
  return real;
}

const WRAPPERS = new Set(["sudo", "env", "nohup", "command", "exec", "time", "nice", "xargs"]);

/**
 * Guardrail (NÃO é sandbox): devolve a entrada bloqueada que casa com algum
 * segmento do comando, ou null. Entradas com espaço casam por prefixo do segmento.
 */
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
