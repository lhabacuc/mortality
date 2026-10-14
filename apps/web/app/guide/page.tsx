import { appUrl } from "@/lib/app-url";
import { canonicalResource } from "@/lib/oauth";

const Code = ({ children }: { children: string }) => (
  <pre style={{ background: "#f4f4f4", padding: 10, overflowX: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{children}</pre>
);
const Table = ({ head, rows }: { head: string[]; rows: string[][] }) => (
  <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14, margin: "8px 0" }}>
    <thead><tr>{head.map((h) => <th key={h} align="left" style={{ borderBottom: "1px solid #888", padding: 6 }}>{h}</th>)}</tr></thead>
    <tbody>{rows.map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i} style={{ borderBottom: "1px solid #ddd", padding: 6, verticalAlign: "top" }}>{c}</td>)}</tr>)}</tbody>
  </table>
);

/** Guia público (sem segredos): explica o modelo, a instalação e a resolução de problemas. */
export default function Guide() {
  const base = appUrl();
  const mcp = canonicalResource(base);
  return (
    <main style={{ maxWidth: 860 }}>
      <h1>Guia do Mortality</h1>
      <p>
        O Mortality deixa clientes de IA (ChatGPT, Claude, Gemini, Cursor, VS Code…) usar as <em>tuas</em> máquinas
        de forma <strong>controlada e revogável</strong>. Tu decides, neste painel, quem acede a quê.
      </p>

      <h2>1. Como funciona</h2>
      <Code>{`Cliente de IA ──(OAuth ou token)──▶ ${mcp}
                                      │  só passa se existir um GRANT (cliente × dispositivo)
                                      ▼
                          fila de jobs ◀── relay no teu PC (sai para fora; sem portas abertas)`}</Code>
      <ul>
        <li><strong>Painel</strong> (aqui): a única fonte de verdade — contas, dispositivos, acessos, aprovações.</li>
        <li><strong>Relay</strong>: um serviço pequeno no teu computador. Liga-se para fora e executa só o que o servidor validou.</li>
        <li><strong>Cliente MCP</strong>: o ChatGPT, o Claude, etc. Por defeito não tem acesso a nada.</li>
      </ul>
      <p><strong>Regra de ouro:</strong> sem acesso explícito dado aqui, o acesso é <em>negado</em>.</p>

      <h2>2. Começar em 5 passos</h2>
      <ol>
        <li><strong>Instala o relay</strong> no computador que queres ligar (secção 3).</li>
        <li><strong>Emparelha</strong>: o comando mostra um código; confirma-o em <a href="/device">Emparelhar dispositivo</a> e dá-lhe um nome.</li>
        <li><strong>Escolhe como o cliente se liga</strong>: OAuth (recomendado, o cliente pede e tu aprovas) ou um <a href="/tokens">token</a>.</li>
        <li><strong>Concede acesso</strong>: dispositivo, permissões, diretórios e duração.</li>
        <li><strong>Usa</strong>: pede ao cliente, por exemplo, «lista os ficheiros de /home/eu/projeto». Acompanha em <a href="/activity">Atividade</a>.</li>
      </ol>

      <h2>3. Instalar o relay</h2>
      <p>Requisitos: Node.js ≥ 18. Linux (systemd), macOS (launchd) ou Windows (Task Scheduler).</p>
      <Code>{`# a partir do repositório do projeto
pnpm install
pnpm --filter mortality build

# emparelhar e instalar o serviço (Linux/macOS/Windows)
node packages/cli/dist/index.js install --server ${base}
#   opcional: --name "o-meu-pc"  --dir /caminho/permitido`}</Code>
      <p>
        O instalador pede o <strong>diretório de trabalho permitido</strong> (a política local), mostra um código e abre o
        painel. Confirma que o código coincide e aprova. Depois o serviço fica a correr em segundo plano.
      </p>
      <p><em>Linux:</em> sem <code>linger</code> o relay só corre com sessão aberta. Para correr após reiniciar:
        <code> loginctl enable-linger $USER</code> (o instalador avisa, mas nunca o executa por ti).</p>

      <h3>Comandos</h3>
      <Table head={["Comando", "O que faz"]} rows={[
        ["mortality install --server URL", "Emparelha o dispositivo e instala/inicia o serviço"],
        ["mortality status [--json]", "Estado do serviço, ligação, pausa local e política ativa"],
        ["mortality logs [-f]", "Mostra (ou segue) os logs do relay"],
        ["mortality pause", "Pausa local imediata: o relay deixa de executar jobs (funciona offline)"],
        ["mortality resume", "Retoma"],
        ["mortality restart", "Reinicia o serviço (termina as sessões de processo em curso)"],
        ["mortality policy show | edit", "Vê/edita a política local (só pode restringir)"],
        ["mortality uninstall", "Revoga o dispositivo no servidor, remove o serviço e apaga a configuração"],
        ["mortality run [--service]", "Corre em primeiro plano (debug)"],
      ]} />
      <p>A CLI <strong>nunca</strong> executa ferramentas nem cria acessos: tudo o que dá acesso nasce neste painel.</p>

      <h2>4. Ligar um cliente</h2>
      <p>Endpoint MCP: <code>{mcp}</code>. Instruções por cliente em <a href="/connect">Ligar</a>. Resumo:</p>
      <ul>
        <li><strong>ChatGPT:</strong> Settings → Connectors → Advanced → Developer mode → Create → URL acima → OAuth.</li>
        <li><strong>Claude.ai:</strong> <em>+</em> → Add custom connector → URL acima.</li>
        <li><strong>Claude Code:</strong> <code>claude mcp add --transport http mortality {mcp}</code></li>
        <li><strong>Sem OAuth:</strong> cria um <a href="/tokens">token</a> e envia-o em <code>Authorization: Bearer …</code>.</li>
      </ul>
      <p>No ecrã de consentimento escolhes <em>que dispositivos</em>, <em>que permissões</em> e <em>por quanto tempo</em>. Sem dispositivo escolhido, o cliente não fica com acesso.</p>

      <h2>5. Permissões</h2>
      <Table head={["Preset", "Inclui", "Quando usar"]} rows={[
        ["Só leitura", "listar, ler, pesquisar, informação do sistema", "Começar aqui. Mais seguro."],
        ["Leitura e escrita", "+ escrever, editar, criar pastas, mover", "Tarefas que alteram ficheiros."],
        ["Terminal", "+ iniciar e controlar processos", "Só com aprovação humana e duração curta."],
        ["Personalizado", "tools à escolha", "Casos específicos."],
      ]} />
      <ul>
        <li><strong>Diretórios permitidos:</strong> o cliente só toca nestas pastas (symlinks e <code>..</code> são resolvidos).</li>
        <li><strong>Comandos bloqueados:</strong> lista de comandos recusados no terminal (guardrail, não sandbox).</li>
        <li><strong>Duração:</strong> 1 h, 24 h, 30 dias ou até revogar. Prefere curtas.</li>
        <li><strong>Política local:</strong> o ficheiro <code>~/.config/mortality/policy.json</code> só pode <em>restringir</em>; o servidor nunca o alarga.</li>
        <li><strong>Teto do administrador:</strong> o admin pode limitar o preset máximo e as tools da tua conta.</li>
      </ul>

      <h2>6. Aprovações humanas</h2>
      <p>
        Em tools sensíveis (por defeito <code>start_process</code> no preset Terminal) o pedido fica à espera em
        <a href="/approvals"> Aprovações</a> com o comando exato. Tens ~30 s para <strong>Aprovar</strong> ou <strong>Negar</strong>;
        se não decidires, é negado.
      </p>

      <h2>7. Desligar e revogar</h2>
      <Table head={["Quero…", "Como"]} rows={[
        ["Cortar um cliente", "Clientes → Revogar este acesso (efeito imediato)"],
        ["Cortar tudo", "Clientes ou Atividade → Desconectar tudo"],
        ["Desativar um dispositivo", "Dispositivos → Desativar (kill-switch no painel)"],
        ["Parar no próprio PC", "mortality pause (kill-switch local; funciona offline)"],
        ["Remover o relay", "mortality uninstall"],
      ]} />

      <h2>8. Segurança — importante</h2>
      <ul>
        <li><strong>Não é uma sandbox.</strong> O relay corre com as permissões do teu utilizador. Para risco alto, usa um container ou VM.</li>
        <li><strong>Prompt injection:</strong> o conteúdo de ficheiros ou páginas pode manipular o modelo. Usa o preset mínimo, aprovação humana e expirações curtas.</li>
        <li>Quem controla a tua conta aqui controla as máquinas concedidas: ativa o <a href="/security">2FA</a>.</li>
      </ul>

      <h2>9. Resolução de problemas</h2>
      <Table head={["Sintoma", "Causa provável", "O que fazer"]} rows={[
        ["«Dispositivo offline»", "Relay parado, PC suspenso ou sem rede", "mortality status; mortality restart; em Linux ativa linger"],
        ["«Dispositivo desativado» / «pausado localmente»", "Kill-switch ativo", "Ativar em Dispositivos, ou mortality resume"],
        ["«Tool … disabled»", "O cliente não tem esse acesso", "Clientes → editar o grant (preset/tools)"],
        ["«Caminho fora dos diretórios permitidos»", "Pasta fora do grant ou da política local", "Adiciona a pasta no grant e/ou mortality policy edit"],
        ["Primeira chamada demora ~20 s", "O relay acorda no intervalo idle", "Normal; as seguintes são rápidas"],
        ["Pedido «negado» no terminal", "Aprovação não dada a tempo", "Repete e aprova em Aprovações dentro de 30 s"],
        ["401 / token expirado", "Token ou acesso expirou", "Reautoriza o conector ou cria novo token"],
        ["O conector não se liga (ChatGPT/Claude)", "Servidor não público/HTTPS ou plano sem conectores", "Confirma o URL e o plano; vê Atividade para a falha"],
      ]} />
      <p>Mais detalhes: <a href="/connect">Ligar clientes</a> · <a href="/activity">Atividade</a>.</p>
    </main>
  );
}
