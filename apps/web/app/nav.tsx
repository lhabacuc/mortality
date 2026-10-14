"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: [string, string][] = [
  ["/dashboard", "Início"],
  ["/devices", "Dispositivos"],
  ["/tokens", "Tokens"],
  ["/clients", "Clientes"],
  ["/approvals", "Aprovações"],
  ["/activity", "Atividade"],
  ["/connect", "Ligar"],
  ["/guide", "Guia"],
  ["/security", "Segurança"],
];

/** Barra de abas; só aparece com sessão. O estado ativo vem do caminho atual. */
export function Nav() {
  const path = usePathname();
  return (
    <nav aria-label="Principal" style={{ display: "flex", gap: 4, flexWrap: "wrap", borderBottom: "1px solid #ccc", marginBottom: 20 }}>
      {TABS.map(([href, label]) => {
        const active = path === href || path.startsWith(href + "/");
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined}
            style={{ padding: "8px 10px", textDecoration: "none", color: active ? "#000" : "#06c", fontWeight: active ? 700 : 400,
              borderBottom: active ? "3px solid #06c" : "3px solid transparent" }}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
