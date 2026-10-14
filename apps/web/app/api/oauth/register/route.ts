import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, schema } from "@/lib/db";
import { jsonCors, preflight } from "@/lib/cors";
import { validRedirectUri } from "@/lib/oauth";
import { allow, clientIp } from "@/lib/ratelimit";
import { newSecret, sha256 } from "@/lib/tokens";

const Body = z.object({
  redirect_uris: z.array(z.string()).min(1).max(10),
  client_name: z.string().trim().min(1).max(80).optional(),
  token_endpoint_auth_method: z.enum(["none", "client_secret_post", "client_secret_basic"]).optional(),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  scope: z.string().max(200).optional(),
}).passthrough();

/** Dynamic Client Registration (RFC 7591), com rate limit por IP. */
export async function POST(req: Request) {
  if (!(await allow(`dcr:${clientIp(req)}`, 20, 3600))) {
    return jsonCors({ error: "temporarily_unavailable", error_description: "Demasiados registos." }, 429);
  }
  const body = Body.safeParse(await req.json().catch(() => null));
  if (!body.success) return jsonCors({ error: "invalid_client_metadata" }, 400);
  const { redirect_uris, client_name } = body.data;
  if (!redirect_uris.every(validRedirectUri)) {
    return jsonCors({ error: "invalid_redirect_uri", error_description: "redirect_uri inválido (https, loopback http ou esquema próprio)." }, 400);
  }
  const grants = body.data.grant_types ?? ["authorization_code"];
  if (!grants.every((g) => g === "authorization_code" || g === "refresh_token")) {
    return jsonCors({ error: "invalid_client_metadata", error_description: "grant_types não suportado." }, 400);
  }

  const method = body.data.token_endpoint_auth_method ?? "none";
  const clientId = `mcl_${randomUUID()}`;
  const secret = method === "none" ? null : newSecret("mcs");
  await db().insert(schema.oauthClients).values({
    clientId, clientSecretHash: secret ? sha256(secret) : null,
    redirectUris: redirect_uris, name: client_name ?? "Cliente MCP",
  });
  return jsonCors({
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    ...(secret ? { client_secret: secret, client_secret_expires_at: 0 } : {}),
    client_name: client_name ?? "Cliente MCP",
    redirect_uris,
    token_endpoint_auth_method: method,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    scope: "mcp:tools",
  }, 201);
}
export const OPTIONS = preflight;
