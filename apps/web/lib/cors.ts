const BASE: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, accept, mcp-protocol-version, mcp-session-id, last-event-id",
  "access-control-expose-headers": "www-authenticate, mcp-session-id",
  "access-control-max-age": "86400",
};

// Só há credenciais por cabeçalho Authorization (nunca cookies) nestes endpoints, por isso `*` é seguro.
export function withCors(res: Response): Response {
  const h = new Headers(res.headers);
  for (const [k, v] of Object.entries(BASE)) h.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

export const preflight = () => new Response(null, { status: 204, headers: BASE });

export function jsonCors(body: unknown, status = 200, extra?: HeadersInit): Response {
  return withCors(Response.json(body, { status, headers: { "cache-control": "no-store", pragma: "no-cache", ...extra } }));
}

export const baseUrl = (req: Request) => (process.env.APP_URL ?? new URL(req.url).origin).replace(/\/$/, "");
