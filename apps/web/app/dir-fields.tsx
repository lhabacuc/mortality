"use client";

import { useState } from "react";

/** Diretórios permitidos / «todos» / bloqueados. O bloqueio prevalece sempre. */
export function DirFields({ dirs = [], blocked = [], allowAll = false, allowAllOk = true }: {
  dirs?: string[]; blocked?: string[]; allowAll?: boolean; allowAllOk?: boolean;
}) {
  const [all, setAll] = useState(allowAll && allowAllOk);
  return (
    <>
      {allowAllOk && (
        <label>
          <input type="checkbox" name="allowAll" checked={all} onChange={(e) => setAll(e.target.checked)} />
          <span>Permitir <strong>todos os diretórios</strong></span>
        </label>
      )}
      {all ? (
        <p className="notice">
          O cliente poderá aceder a qualquer pasta que o utilizador do relay alcance. Combina com «Diretórios bloqueados»
          e com o preset mínimo. A política local do dispositivo continua a limitar (<code>mortality policy allow-all on</code>).
        </p>
      ) : (
        <label>Diretórios permitidos (um por linha)
          <textarea name="dirs" rows={3} defaultValue={dirs.join("\n")} placeholder="/home/user/projeto" />
        </label>
      )}
      <label>Diretórios bloqueados (um por linha; prevalecem sobre tudo)
        <textarea name="blockedDirs" rows={2} defaultValue={blocked.join("\n")} placeholder="/home/user/.ssh" />
      </label>
    </>
  );
}
