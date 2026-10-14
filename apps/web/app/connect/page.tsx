import { requireUser } from "@/lib/guard";
import { CodeBlock } from "@/components/code-block";
import { canonicalResource } from "@/lib/oauth";
import { appUrl } from "@/lib/app-url";

const Code = ({ children }: { children: string }) => <CodeBlock>{children}</CodeBlock>;

/** Formatos verificados na documentação de cada cliente em 2026-10-14 (ver README: testado vs esperado). */
export default async function Connect() {
  await requireUser();
  const base = appUrl();
  const url = canonicalResource(base);
  const PAT = "<O_TEU_TOKEN_mpat_…>";
  return (
    <main>
      <h1>Ligar clientes MCP</h1>
      <p>Endpoint: <code>{url}</code> (Streamable HTTP). Dois modos de autenticação:</p>
      <ul>
        <li><strong>OAuth</strong> (recomendado): o cliente regista-se sozinho e mostra-te um ecrã onde escolhes dispositivos, permissões e duração.</li>
        <li><strong>Token (PAT)</strong>: para clientes sem OAuth; cria-o em <a href="/tokens">Tokens</a> (já com dispositivo e permissões) e usa <code>Authorization: Bearer …</code>.</li>
      </ul>
      <p>Sem grant explícito, o acesso é sempre negado.</p>

      <h2>Claude.ai / Claude Desktop</h2>
      <p>Menu <em>+</em> → <em>Add custom connector</em> (Team/Enterprise: um Owner adiciona em <em>Settings → Connectors</em>). Cola o URL abaixo e conclui o login OAuth. O servidor tem de ser acessível pela internet pública.</p>
      <Code>{url}</Code>

      <h2>Claude Code</h2>
      <Code>{`# OAuth (depois corre /mcp dentro do Claude Code e conclui o login)
claude mcp add --transport http mortality ${url}

# ou com token
claude mcp add --transport http mortality ${url} \\
  --header "Authorization: Bearer ${PAT}"`}</Code>
      <p>Em <code>.mcp.json</code>:</p>
      <Code>{JSON.stringify({ mcpServers: { mortality: { type: "http", url } } }, null, 2)}</Code>

      <h2>ChatGPT</h2>
      <p>Ativa o <em>Developer mode</em> (Settings → Connectors → Advanced; os nomes dos menus e os planos com acesso variam) e depois <em>Create</em>: nome, URL abaixo e autenticação <em>OAuth</em>. Em contas Business/Enterprise um admin do workspace pode ter de permitir conectores personalizados.</p>
      <Code>{url}</Code>

      <h2>Gemini (web)</h2>
      <p>
        Adiciona o servidor MCP com o URL abaixo e escolhe autenticação <strong>OAuth</strong>: o Gemini regista-se sozinho e
        mostra o ecrã de consentimento onde escolhes dispositivos, permissões e duração. Se o teu ecrã pedir mesmo
        <strong>Client ID e Secret</strong>, cria-os em <a href="/clients">Clientes → Registar cliente OAuth</a> com o
        <em> redirect URI</em> que o Gemini mostra.
      </p>
      <Code>{url}</Code>
      <p className="alert">Nunca coles um token (<code>mpat_…</code>) em «Client ID»: aparece no URL e é revogado automaticamente.</p>

      <h2>Gemini CLI</h2>
      <Code>{`gemini mcp add --transport http mortality ${url}
# depois, dentro do Gemini CLI:  /mcp auth mortality

# ou com token
gemini mcp add --transport http --header "Authorization: Bearer ${PAT}" mortality ${url}`}</Code>
      <p>Em <code>settings.json</code> (Streamable HTTP usa <code>httpUrl</code>; evita <code>_</code> no nome):</p>
      <Code>{JSON.stringify({ mcpServers: { mortality: { httpUrl: url, headers: { Authorization: `Bearer ${PAT}` } } } }, null, 2)}</Code>

      <h2>Cursor</h2>
      <p><code>~/.cursor/mcp.json</code> (global) ou <code>.cursor/mcp.json</code> (projeto):</p>
      <Code>{JSON.stringify({ mcpServers: { mortality: { url, headers: { Authorization: "Bearer ${env:MORTALITY_PAT}" } } } }, null, 2)}</Code>
      <p>Sem <code>headers</code>, o Cursor usa OAuth.</p>

      <h2>VS Code (Copilot)</h2>
      <p><code>.vscode/mcp.json</code> (a chave de topo é <code>servers</code>; o token é pedido uma vez e guardado de forma segura):</p>
      <Code>{JSON.stringify({
        inputs: [{ type: "promptString", id: "mortality-pat", description: "Token Mortality", password: true }],
        servers: { mortality: { type: "http", url, headers: { Authorization: "Bearer ${input:mortality-pat}" } } },
      }, null, 2)}</Code>

      <h2>Grok, Qwen e outros</h2>
      <p>Usa um token (PAT) se o cliente permitir cabeçalhos personalizados num servidor MCP HTTP:</p>
      <Code>{`URL:     ${url}
Header:  Authorization: Bearer ${PAT}

# verificação rápida
curl -s ${url} \\
  -H "Authorization: Bearer ${PAT}" \\
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`}</Code>

      <h2>Segurança</h2>
      <ul>
        <li>Conteúdo de ficheiros e páginas pode manipular o modelo (prompt injection): usa o preset mínimo, aprovação humana em <code>start_process</code> e expirações curtas.</li>
        <li>As restrições de diretórios/comandos são guardrails, <strong>não uma sandbox</strong>. Para risco alto corre o relay num container ou VM.</li>
        <li>Quem controla a tua conta no painel ou o cliente autorizado controla as máquinas concedidas: ativa o <a href="/security">2FA</a>.</li>
      </ul>
          </main>
  );
}
