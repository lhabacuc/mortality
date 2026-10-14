import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { commandBlocked, pathAllowed } from "@mortality/shared";
import { audit } from "@/lib/audit";
import { baseUrl, preflight, withCors } from "@/lib/cors";
import { canonicalResource } from "@/lib/oauth";
import { bearer } from "@/lib/tokens";
import { clientIp, allow } from "@/lib/ratelimit";
import { JobError, runJob } from "@/lib/jobs";
import { AccessError, activeGrants, authenticateMcp, resolveDevice, type McpContext } from "@/lib/mcp-access";
import { MAX_RESPONSE_CHARS, RELAY_TOOLS, describeForApproval, summarizeArgs } from "@/lib/mcp-tools";

export const maxDuration = 60;

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], isError });

async function buildServer(ctx: McpContext, ip: string) {
  const grants = await activeGrants(ctx);
  const server = new McpServer({ name: "mortality", version: "0.2.0" });
  const allowed = new Set(grants.flatMap((g) => g.tools));

  /** Verificação completa por chamada (secção 7.7) + job + audit. */
  async function call(tool: string, args: Record<string, unknown>) {
    const def = RELAY_TOOLS[tool];
    const summary = summarizeArgs(args);
    let deviceId: string | undefined;
    try {
      const g = resolveDevice(await activeGrants(ctx), tool, args.device as string | undefined);
      deviceId = g.device.id;
      const paths = [
        ...(def.paths ?? []).map((k) => args[k]).filter((v): v is string => typeof v === "string"),
        ...(def.pathLists ?? []).flatMap((k) => (Array.isArray(args[k]) ? (args[k] as string[]) : [])),
      ];
      for (const p of paths) {
        const r = pathAllowed(g.permissions, p);
        if (!r.ok) throw new AccessError(r.reason === "blocked" ? "Caminho bloqueado." : "Caminho fora dos diretórios permitidos.");
      }
      if (tool === "start_process") {
        const hit = commandBlocked(String(args.command), g.permissions.blockedCommands);
        if (hit) throw new AccessError(`Comando bloqueado: "${hit}".`);
      }
      const { device: _d, ...jobArgs } = args;
      const result = await runJob({
        userId: ctx.userId, deviceId: g.device.id, clientId: ctx.clientKey, tool,
        args: jobArgs, permissions: g.permissions,
        approval: g.requireApprovalFor.includes(tool) ? { summary: describeForApproval(tool, jobArgs) } : undefined,
      });
      await audit({ userId: ctx.userId, deviceId, clientId: ctx.clientKey, actor: "mcp", action: "tool.call", tool, argsSummary: summary, ip });
      let out = JSON.stringify(result, null, 2);
      if (out.length > MAX_RESPONSE_CHARS) out = out.slice(0, MAX_RESPONSE_CHARS) + "\n…[truncado]";
      return text(out);
    } catch (e) {
      const known = e instanceof AccessError || e instanceof JobError;
      await audit({ userId: ctx.userId, deviceId, clientId: ctx.clientKey, actor: "mcp", action: "tool.denied", tool, argsSummary: summary, ok: false, ip });
      return text(known ? e.message : "Erro interno.", true);
    }
  }

  // Sempre registadas: dizem ao cliente em que estado está (e mantêm `tools/list` funcional sem grants).
  server.registerTool("whoami", { description: "Utilizador e dispositivos acessíveis.", annotations: { readOnlyHint: true } },
    async () => text(JSON.stringify({
      user: ctx.userEmail, devices: grants.map((g) => g.device.name),
      note: grants.length ? undefined : "Sem acessos ativos: concede acesso a este cliente no painel.",
    })));
  server.registerTool("list_devices", { description: "Lista os dispositivos a que este cliente tem acesso.", annotations: { readOnlyHint: true } },
    async () => text(JSON.stringify(grants.map((g) => ({
      name: g.device.name, os: g.device.os, enabled: g.device.enabled, paused_locally: g.device.pausedLocally,
      online: !!g.device.lastSeenAt && Date.now() - g.device.lastSeenAt.getTime() < 45_000,
      tools: g.tools, expires_at: g.expiresAt,
    })), null, 2)));

  for (const [name, def] of Object.entries(RELAY_TOOLS)) {
    const tool = server.registerTool(name, {
      description: def.description, inputSchema: def.shape,
      annotations: { readOnlyHint: def.readOnly, destructiveHint: !!def.destructive },
    }, async (args: Record<string, unknown>) => call(name, args));
    // Sem grant para a tool: não aparece em `tools/list` e a chamada falha com "disabled".
    if (!allowed.has(name)) tool.disable();
  }
  return server;
}

export async function POST(req: Request) {
  const base = baseUrl(req);
  const ctx = await authenticateMcp(req, canonicalResource(base));
  if (!ctx) {
    const invalid = bearer(req) ? `error="invalid_token", ` : "";
    return withCors(new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: {
        "content-type": "application/json",
        "www-authenticate": `Bearer ${invalid}resource_metadata="${base}/.well-known/oauth-protected-resource"`,
      },
    }));
  }
  const ip = clientIp(req);
  if (!(await allow(`mcp:${ctx.tokenId}`, 120, 60))) return withCors(new Response("rate limited", { status: 429 }));

  const server = await buildServer(ctx, ip);
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return withCors(await transport.handleRequest(req));
}

const notAllowed = () => withCors(new Response("Method not allowed", { status: 405, headers: { allow: "POST" } }));
export const GET = notAllowed;
export const DELETE = notAllowed;
export const OPTIONS = preflight;
