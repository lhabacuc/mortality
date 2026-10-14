import type { ReactNode } from "react";

export const metadata = { title: "Mortality", description: "Painel de controlo de acesso remoto MCP" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 720, margin: "2rem auto", padding: "0 1rem" }}>
        {children}
      </body>
    </html>
  );
}
