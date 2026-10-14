"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/actions";

const TABS: [string, string][] = [
  ["/dashboard", "Início"],
  ["/devices", "Dispositivos"],
  ["/clients", "Clientes"],
  ["/tokens", "Tokens"],
  ["/approvals", "Aprovações"],
  ["/activity", "Atividade"],
  ["/connect", "Ligar"],
  ["/guide", "Guia"],
  ["/security", "Segurança"],
];

const AUTH_ROUTES = ["/login", "/signup", "/change-password", "/oauth/authorize"];

export function Nav() {
  const path = usePathname();
  // Nas páginas de autenticação só se mostra a marca (um cookie antigo não deve fingir sessão).
  if (AUTH_ROUTES.some((r) => path === r || path.startsWith(r + "/"))) {
    return (
      <header className="topbar">
        <Link href="/" className="brand"><img src="/logo.png" alt="Mortality" width={104} height={33} className="logo" /></Link>
        <nav className="tabs" aria-label="Principal"><Link href="/guide">Guia</Link></nav>
      </header>
    );
  }
  return (
    <header className="topbar">
      <Link href="/dashboard" className="brand"><img src="/logo.png" alt="Mortality" width={104} height={33} className="logo" /></Link>
      <nav className="tabs" aria-label="Principal">
        {TABS.map(([href, label]) => (
          <Link key={href} href={href} aria-current={path === href || path.startsWith(href + "/") ? "page" : undefined}>
            {label}
          </Link>
        ))}
      </nav>
      <form action={logout}><button className="linklike">Sair</button></form>
    </header>
  );
}
