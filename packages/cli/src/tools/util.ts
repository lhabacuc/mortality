import type { JobPermissions, Policy } from "../policy.ts";

export interface ToolContext { permissions: JobPermissions; policy: Policy; clientId: string }
export type Args = Record<string, unknown>;
export type Tool = (args: Args, ctx: ToolContext) => unknown;

export function reqString(a: Args, k: string, max = 4096): string {
  const v = a[k];
  if (typeof v !== "string" || v.length === 0) throw new Error(`\`${k}\` em falta ou inválido.`);
  if (v.length > max) throw new Error(`\`${k}\` demasiado grande.`);
  return v;
}

export function optString(a: Args, k: string, max = 4096): string | undefined {
  return a[k] === undefined ? undefined : reqString(a, k, max);
}

export function optInt(a: Args, k: string, min: number, max: number, def: number): number {
  const v = a[k];
  if (v === undefined) return def;
  if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
    throw new Error(`\`${k}\` tem de ser inteiro entre ${min} e ${max}.`);
  }
  return v;
}

export function assertWritable(ctx: ToolContext) {
  if (ctx.permissions.readOnly || ctx.policy.read_only) throw new Error("Dispositivo em modo só leitura.");
}
