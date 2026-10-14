import { appUrl } from "@/lib/app-url";
import { installScript, safeOrigin } from "@/lib/install-script";

/** `curl -fsSL <painel>/install | bash` — instala a CLI a partir deste mesmo servidor. */
export async function GET(req: Request) {
  const origin = safeOrigin(appUrl(new URL(req.url).origin));
  if (!origin) return new Response("origem inválida\n", { status: 500 });
  return new Response(installScript(origin), {
    headers: {
      "content-type": "text/x-shellscript; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
