import { eq } from "drizzle-orm";
import { db, schema } from "./db";
import { safeEqual, sha256 } from "./tokens";

/** Autentica o cliente no token/revoke: público (PKCE) ou com segredo (post/basic). */
export async function authClient(req: Request, form: URLSearchParams) {
  let clientId = form.get("client_id") ?? "";
  let secret = form.get("client_secret");
  const basic = /^Basic (.+)$/i.exec(req.headers.get("authorization") ?? "");
  if (basic) {
    const [id, ...rest] = Buffer.from(basic[1], "base64").toString().split(":");
    clientId = decodeURIComponent(id);
    secret = decodeURIComponent(rest.join(":"));
  }
  if (!clientId) return null;
  const [c] = await db().select().from(schema.oauthClients).where(eq(schema.oauthClients.clientId, clientId)).limit(1);
  if (!c) return null;
  if (c.clientSecretHash && !(secret && safeEqual(sha256(secret), c.clientSecretHash))) return null;
  return c;
}
