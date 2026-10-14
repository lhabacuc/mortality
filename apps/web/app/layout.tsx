import type { ReactNode } from "react";
import { cookies } from "next/headers";
import Link from "next/link";
import { Nav } from "./nav";
import "./globals.css";

export const metadata = { title: "Mortality", description: "Acesso remoto controlado para clientes MCP" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Só mostra as abas se existir cookie de sessão (a validação real é feita em cada página).
  const loggedIn = (await cookies()).has("mortality_session");
  return (
    <html lang="pt">
      <body>
        <div className="shell">
          {loggedIn ? <Nav /> : (
            <header className="topbar">
              <Link href="/" className="brand">mortality</Link>
              <nav className="tabs" aria-label="Principal"><Link href="/guide">Guia</Link></nav>
            </header>
          )}
          {children}
        </div>
      </body>
    </html>
  );
}
