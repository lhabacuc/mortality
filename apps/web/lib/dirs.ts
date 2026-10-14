/** Validação partilhada dos campos de diretórios de um grant (painel, tokens e consentimento OAuth). */
const ABS = /^(\/|[a-zA-Z]:[\\/])/;
const lines = (v: FormDataEntryValue | null) =>
  [...new Set(String(v ?? "").split("\n").map((l) => l.trim()).filter(Boolean))].slice(0, 20);

export interface DirFields { allowedDirs: string[]; blockedDirs: string[]; allowAllDirs: boolean }

export function parseDirFields(form: FormData, allowAllOk: boolean): { value: DirFields } | { error: string } {
  const allowAll = form.get("allowAll") === "on";
  const allowed = lines(form.get("dirs"));
  const blocked = lines(form.get("blockedDirs"));

  if (allowAll && !allowAllOk) return { error: "O administrador não permite «todos os diretórios» para a tua conta." };
  const bad = [...allowed, ...blocked].find((d) => d.length > 1024 || !ABS.test(d));
  if (bad) return { error: `Caminho inválido: «${bad.slice(0, 60)}». Usa caminhos absolutos (um por linha).` };
  if (!allowAll && !allowed.length) return { error: "Indica pelo menos um diretório permitido, ou escolhe «todos os diretórios»." };
  if (blocked.some((d) => d === "/" || /^[a-zA-Z]:[\\/]?$/.test(d))) {
    return { error: "Bloquear a raiz bloquearia tudo. Indica um diretório concreto." };
  }
  return { value: { allowedDirs: allowAll ? [] : allowed, blockedDirs: blocked, allowAllDirs: allowAll } };
}
