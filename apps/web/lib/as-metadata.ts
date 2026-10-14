import { baseUrl, jsonCors } from "./cors";
import { SCOPE } from "./oauth";

/** RFC 8414 (e openid-configuration por compatibilidade). */
export function asMetadata(req: Request) {
  const b = baseUrl(req);
  return jsonCors({
    issuer: b,
    authorization_endpoint: `${b}/oauth/authorize`,
    token_endpoint: `${b}/api/oauth/token`,
    registration_endpoint: `${b}/api/oauth/register`,
    revocation_endpoint: `${b}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    revocation_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    scopes_supported: [SCOPE],
    service_documentation: `${b}/`,
  });
}
