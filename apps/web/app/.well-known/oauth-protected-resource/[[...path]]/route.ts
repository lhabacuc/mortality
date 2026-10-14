import { baseUrl, jsonCors, preflight } from "@/lib/cors";
import { canonicalResource } from "@/lib/oauth";
import { SCOPE } from "@/lib/oauth";

// RFC 9728. Também responde em /.well-known/oauth-protected-resource/api/mcp (variante com caminho).
export async function GET(req: Request) {
  const base = baseUrl(req);
  return jsonCors({
    resource: canonicalResource(base),
    authorization_servers: [base],
    scopes_supported: [SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "Mortality",
  });
}
export const OPTIONS = preflight;
