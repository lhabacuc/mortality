import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { Nav } from "./nav";

export const metadata = { title: "Mortality", description: "Painel de controlo de acesso remoto MCP" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Só mostra a barra se existir cookie de sessão (a validação real é feita em cada página).
  const loggedIn = (await cookies()).has("mortality_session");
  return (
    <html lang="pt">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 960, margin: "1.5rem auto", padding: "0 1rem" }}>
        {loggedIn && <Nav />}
        {children}
      </body>
    </html>
  );
}
