# BRIEF v2 PARA CLAUDE CODE — "Remote Shell MCP" (painel web + relay em systemd --user)

> Substitui a v1. Mudança central: **o painel web é o único plano de controlo**. A CLI não dá acesso a nada:
> só instala/gere um **relay** que corre em background no userspace (`systemctl --user`).
> Quem acede à máquina são **apenas clientes MCP** (Claude, ChatGPT, Gemini, Grok, Qwen...) que o utilizador
> autorizou **no painel web**, para **dispositivos concretos**, com permissões concretas. Por defeito: **acesso negado**.
> Deploy em **Vercel** + **Neon (Postgres)**. Lê tudo antes de codar; trabalha por fases (secção 12).

---

## 0. Pressupostos (confirma antes de começar)

1. "neodb" = **Neon DB** (Postgres serverless). Se não, adapta só a camada `db/`.
2. "Sem depender de servidores" = sem VPS/infra própria. Vercel + Neon são serviços geridos e aceitáveis.
3. Linux com systemd é o alvo primário. macOS (launchd) e Windows (Task Scheduler) ficam na fase 7.
4. UI e mensagens em português por defeito.
5. Nunca inventes versões ou formatos de configuração: consulta a documentação atual (MCP spec, MCP SDK, Next.js, Drizzle, Neon, cada cliente).

---

## 1. Modelo mental (os 3 atores)

```
 PAINEL WEB  ──── controla ────▶  quem pode o quê, em que dispositivo
 (única fonte de verdade: contas, aprovações, grants, permissões, kill-switch)

 CLIENTE MCP (Claude, ChatGPT, Gemini...)
     └─ liga-se a /api/mcp com token OAuth/PAT
     └─ só consegue usar dispositivos para os quais o painel lhe deu um GRANT

 RELAY (daemon systemd --user no PC)
     └─ liga-se para fora ao servidor, executa jobs que o servidor validou
     └─ NÃO é controlado por nenhum comando de CLI; a CLI só instala/pausa/remove
```

**Regras de ouro:**
- A CLI **nunca** executa tools, nunca fala MCP, nunca guarda credenciais de utilizador/admin. Só guarda o `device_token` do relay.
- Nenhum cliente MCP tem acesso por existir ou por ter conta: precisa de **grant explícito (cliente × dispositivo)** dado no painel.
- A política **local** do PC pode apenas **restringir** o que o servidor permite, nunca alargar.

---

## 2. Referência: como funciona o Remote Desktop Commander (RDC)

Fonte: https://github.com/desktop-commander/remote-desktop-commander (repo só de docs/manifestos; serviço hospedado proprietário). Motor local open source: https://github.com/wonderwhy-er/DesktopCommanderMCP (verifica a licença antes de reutilizar código).

- Endpoint MCP hospedado `https://mcp.desktopcommander.app/mcp`, **Streamable HTTP**, **OAuth 2.0 + PKCE**.
- Um agente local (`npx @wonderwhy-er/desktop-commander@latest remote`) liga-se **para fora** ao relay hospedado; sem portas abertas.
- Emparelhamento por **OAuth Device Authorization Flow** (código curto confirmado no browser).
- Acesso só enquanto o agente corre; dispositivos revogáveis no dashboard; vários PCs por conta, endereçáveis por nome.
- Tools: ler/listar ficheiros, pesquisa assíncrona, escrever/editar, mover, processos (start/input/read output/list/terminate), listar dispositivos, info de conta, config.
- Modelo de confiança: corre com permissões do utilizador; restrições de diretórios/comandos são guardrails, **não sandbox**; recomenda container/VM para risco alto.

**Diferenças do nosso projeto:** open source e self-deploy na Vercel; **conta admin** que aprova contas; multiusuário isolado; **grants por cliente MCP × dispositivo geridos só no painel**; relay como **serviço systemd de utilizador**; compatibilidade ampla com clientes MCP; sem Redis nem WebSockets.

---

## 3. Arquitetura (serverless)

Funções Vercel não mantêm WebSockets → **fila de jobs no Postgres + long-poll outbound do relay**.

```
Cliente MCP ──▶ /api/mcp (Vercel) ──valida token + grant──▶ INSERT job (Neon)
                      │ espera resultado (poll curto à BD)          ▲
                      ▼                                             │ SELECT ... FOR UPDATE SKIP LOCKED
                 devolve result                      Relay (systemd --user) ──long-poll──▶ /api/relay/poll
                                                     Relay ──POST──▶ /api/relay/result
```

- `/api/mcp` respeita o `maxDuration` do plano Vercel (verifica limites atuais; timeout interno com margem).
- Comandos longos: `start_process` devolve logo `session_id`; o relay mantém o processo; `read_process_output` devolve incrementos. Nunca bloquear um request até ao fim de um comando.
- `devices.last_seen_at` atualizado a cada poll; "online" se < 45 s.
- Jobs expiram (`expires_at`); limpeza lazy ou Vercel Cron.

### 3.1 Custo de um relay sempre ligado (decisão importante)
Um relay permanente a fazer poll 24/7 consome invocações Vercel e **mantém o Neon acordado** (autosuspend nunca dispara). Implementa **polling adaptativo**:
- **Modo idle:** long-poll mais espaçado (ex.: 15–30 s) quando não houve atividade recente.
- **Modo ativo:** long-poll curto/rápido (~1 s) durante N minutos após o último job ou quando o painel marca uma sessão de cliente como ativa.
- Intervalos configuráveis; o servidor devolve ao relay o intervalo recomendado na resposta do poll.
- Latência da **primeira** chamada após inatividade ≤ intervalo idle; documenta este trade-off.
- Mede e documenta o consumo real (invocações/dia, horas de compute Neon) face aos limites atuais dos planos gratuitos.
- Alternativa opcional (propõe ao utilizador, não implementes sem acordo): um sinal de "wake" num KV/Redis gerido, para o poll idle não tocar na BD.

---

## 4. Stack

- **TypeScript**, monorepo simples. **Next.js (App Router)** na Vercel: API routes + painel web.
- **MCP:** `@modelcontextprotocol/sdk` com Streamable HTTP **stateless** (ou `mcp-handler`, se estiver atual).
- **BD:** Neon via `@neondatabase/serverless` + **Drizzle ORM** + migrações.
- **Zod** em todas as entradas. Passwords com `crypto.scrypt` (sem deps nativas). Tokens guardados **só como hash SHA-256**.
- **CLI/relay:** pacote npm (`packages/cli`), Node ≥ 18, sem dependências pesadas. Binário `rsm` (nome provisório — pergunta).

```
/
├─ apps/web/
│  ├─ app/
│  │  ├─ .well-known/{oauth-authorization-server,oauth-protected-resource,openid-configuration}/route.ts
│  │  ├─ api/mcp/route.ts
│  │  ├─ api/oauth/{register,authorize,token,revoke,device,device/token}/route.ts
│  │  ├─ api/relay/{poll,result}/route.ts
│  │  ├─ api/panel/...                 # tudo o que o painel usa (admin + utilizador)
│  │  └─ (ui)/login, signup, device, dashboard, devices, clients, access, admin, audit
│  └─ lib/{db,auth,oauth,grants,jobs,permissions,audit,ratelimit}.ts
├─ packages/cli/                       # instalador + relay (SEM tools de admin, SEM MCP)
│  └─ src/{index,install,service,relay,policy,tools/*}.ts
├─ packages/shared/                    # schemas Zod, tipos de jobs
└─ README.md, .env.example
```

---

## 5. Modelo de dados

```
users            id, email, password_hash, name, role ('admin'|'user'), status ('pending'|'active'|'suspended'),
                 created_at, approved_by, approved_at
devices          id, user_id, name, os, relay_version, enabled bool (default true), last_seen_at, revoked_at
                 UNIQUE(user_id, name)
device_tokens    id, device_id, token_hash, created_at, last_used_at, revoked_at     -- só serve /api/relay/*
oauth_clients    id, client_id, client_secret_hash NULL, redirect_uris[], name, created_at   -- DCR
auth_codes       code_hash, client_id, user_id, redirect_uri, code_challenge, resource, scope, expires_at, used_at
access_tokens    id, token_hash, user_id, client_id NULL, kind ('oauth'|'pat'), name NULL, scope, resource,
                 expires_at, revoked_at, last_used_at
refresh_tokens   id, token_hash, user_id, client_id, family_id, expires_at, used_at, revoked_at
device_codes     device_code_hash, user_code, user_id NULL, status, interval, expires_at

client_grants    id, user_id, client_id (oauth client OU pat id), device_id,
                 preset ('read_only'|'read_write'|'terminal'|'custom'),
                 allowed_tools[], allowed_dirs[], blocked_commands[], read_only bool,
                 require_approval_for[] (tools que exigem aprovação humana no painel),
                 expires_at NULL, revoked_at NULL, created_at
                 UNIQUE(client_id, device_id) WHERE revoked_at IS NULL
                 -- SEM grant = SEM acesso (deny by default)

jobs             id, user_id, device_id, client_id, tool, args jsonb,
                 status ('awaiting_approval'|'queued'|'claimed'|'done'|'error'|'expired'|'denied'),
                 result jsonb, error text, created_at, claimed_at, completed_at, expires_at
audit_log        id, user_id, device_id, client_id, actor, action, tool, args_summary (SEM conteúdo de ficheiros),
                 ok bool, ip, created_at     -- apenas INSERT
rate_limits      key, window_start, count
```

---

## 6. Painel web = plano de controlo (única forma de autorizar)

**Páginas do utilizador**
- **Dispositivos:** lista com online/offline, versão do relay, botão **Ativar/Desativar** (kill-switch por dispositivo, efeito imediato), revogar, renomear. Instruções de instalação com o comando pronto a copiar.
- **Clientes ligados:** cada cliente MCP (OAuth ou PAT) com último uso, dispositivos a que tem acesso e preset. Editar grant, definir expiração, **revogar**.
- **Aceder / Atividade:** feed em tempo quase-real das tool calls (tool, dispositivo, cliente, ok/erro; sem conteúdo). Botão **"Desconectar tudo"** (revoga todos os grants e tokens do utilizador).
- **Aprovações pendentes:** jobs em `awaiting_approval` com resumo do que vai ser executado; Aprovar/Negar (timeout → negado).
- **Tokens (PAT):** criar/revogar para clientes sem OAuth; cada PAT **nasce sem acesso** e exige grant (cliente × dispositivo) no mesmo ecrã.
- **Password / (opcional) TOTP.**

**Consentimento OAuth (passo crítico)**
Ao autorizar um cliente MCP novo, o ecrã de consentimento mostra: nome do cliente, utilizador, e obriga a escolher **que dispositivos** e **que preset**:
- `Só leitura` (list/read/search/info)
- `Leitura e escrita` (+ write/edit/move/mkdir)
- `Terminal` (+ processos) — recomendar `require_approval_for: [start_process]`
- `Personalizado`
+ duração do acesso (1 h / 24 h / 30 d / até revogar). Sem escolher dispositivo → não emite token útil. Utilizador `pending`/`suspended` não consegue concluir.

**Páginas do admin**
- Utilizadores: listar, aprovar, recusar, suspender, reativar, apagar, promover/despromover (nunca ficar sem admin).
- Limites máximos por utilizador (ferramentas permitidas, nº de dispositivos, preset máximo) — o grant do utilizador nunca excede o teto definido pelo admin.
- Ver/revogar dispositivos, grants e tokens de qualquer utilizador; "revogar tudo" de um utilizador.
- Audit log global (filtros, exportação), `SIGNUP_MODE` (`open|approval|invite_only`), convites de uso único.
- **Bootstrap do admin:** `ADMIN_EMAIL` + `ADMIN_PASSWORD` no primeiro arranque; troca obrigatória no 1º login.

**Isolamento:** toda a query filtra por `user_id`. Teste obrigatório: utilizador A nunca vê nem usa dispositivos/grants de B.

---

## 7. Autenticação para clientes MCP (compatibilidade ampla)

Implementa o fluxo de autorização MCP (confirma a revisão atual da spec em https://modelcontextprotocol.io):

1. `/api/mcp` sem token → `401` com `WWW-Authenticate: Bearer resource_metadata="https://<host>/.well-known/oauth-protected-resource"`.
2. **Protected Resource Metadata (RFC 9728)** e **Authorization Server Metadata (RFC 8414)** (+ `openid-configuration` por compatibilidade). `code_challenge_methods_supported: ["S256"]`.
3. **Dynamic Client Registration (RFC 7591)** com rate limit.
4. **Authorization Code + PKCE S256**, `redirect_uri` com correspondência exata, parâmetro `resource` (RFC 8707) ligado ao token (audience).
5. Access token curto (~1 h), **refresh com rotação** e deteção de reutilização (revoga a família).
6. Revogação (`/api/oauth/revoke`). Scopes simples: `mcp:tools`.
7. **Verificação em cada `tools/call`:** token válido + utilizador `active` + dispositivo `enabled` e online + **grant ativo para (cliente, dispositivo)** + tool dentro do grant + argumentos dentro de `allowed_dirs`/`blocked_commands`. Qualquer falha → erro claro e linha no audit.
8. **PAT para clientes sem OAuth/DCR** (Grok, Qwen, SDKs): `Authorization: Bearer rsm_pat_...`, mostrado uma vez, guardado como hash, criado **só no painel**, mesmo pipeline de grants/permissões/audit.
   - **Não** existe `rsm bridge`, nem criação de tokens via CLI: tudo o que dá acesso nasce no painel.

**Compatibilidade — detalhes a cuidar**
- CORS correto em `/api/mcp`, `/.well-known/*`, `/api/oauth/*` (claude.ai e chatgpt.com fazem pedidos cross-origin).
- Suportar `initialize`, `tools/list`, `tools/call`, `ping`; ignorar com graça o desconhecido.
- Nomes de tools `snake_case`, ≤ 64 chars, `[a-zA-Z0-9_-]`. JSON Schemas simples (evitar `oneOf` complexos e `$ref` circulares — Gemini/Qwen são estritos).
- Respostas `content: [{type:"text", text}]`; truncar saídas grandes.
- `tools/list` pode devolver apenas as tools que o grant permite (menos ruído para o modelo).

**Snippets de configuração por cliente (gerados no painel, verifica a doc atual de cada um):**
Claude.ai/Desktop (custom connector), Claude Code (`claude mcp add --transport http ...`), ChatGPT (Developer mode → Create connector), Gemini CLI, Cursor (`mcp.json`), VS Code (`.vscode/mcp.json`, `type: http`), Grok/Qwen/outros via PAT onde o cliente permitir headers. Marca no README o que foi **testado** vs **esperado funcionar**.

---

## 8. Relay local (systemd --user)

### 8.1 Papel
Daemon de longa duração que: faz long-poll ao servidor, executa jobs, devolve resultados. **Não aceita comandos de nenhum cliente local** (sem socket local, sem porta, sem API local de execução). A única interface local é a CLI de gestão (8.3).

### 8.2 Instalação — `rsm install`
1. Device Authorization Flow (RFC 8628): mostra `user_code`, abre `/device` no browser; o utilizador **entra no painel, confirma o código e dá nome ao dispositivo**.
2. Guarda `device_token` em `~/.config/rsm/device.json` (`0600`, diretório `0700`). Não guarda nenhuma credencial de utilizador.
3. Cria política local por defeito `~/.config/rsm/policy.json` (ver 8.5).
4. Gera e instala a unit `~/.config/systemd/user/rsm-relay.service` e executa `systemctl --user daemon-reload && systemctl --user enable --now rsm-relay`.
5. Verifica o *linger*: se `loginctl show-user $USER -p Linger` for `no`, **explica** que sem linger o relay só corre com sessão aberta e mostra o comando `loginctl enable-linger $USER` (pode exigir privilégios; **não** o executes sem confirmação do utilizador).
6. Mostra o resultado (`active`, nome do dispositivo, URL do painel).

Unit gerada (exemplo — resolve caminhos absolutos em tempo de instalação via `process.execPath` e caminho real do script, para funcionar com nvm/volta/pnpm):

```ini
[Unit]
Description=RSM relay (user)
After=network-online.target
Wants=network-online.target
StartLimitIntervalSec=0

[Service]
Type=simple
ExecStart=/abs/path/to/node /abs/path/to/rsm/dist/index.js run --service
Restart=always
RestartSec=5
NoNewPrivileges=yes
PrivateTmp=yes
# Hardening extra só se testado: em user services algumas opções (ProtectSystem, etc.) podem não funcionar
# e restringir demais quebra a utilidade (o relay precisa de aceder ao home e executar comandos).

[Install]
WantedBy=default.target
```

Notas:
- `rsm install` é idempotente e sobrescreve a unit de forma segura (com backup).
- Com `KillMode=control-group` (defeito), reiniciar o serviço mata os processos filhos das sessões; documenta isto.
- Logs: `journalctl --user -u rsm-relay`; o relay **não** regista tokens nem conteúdo de ficheiros.
- Reconexão com backoff exponencial + jitter; deteta `401/403` (dispositivo revogado) e **para** o serviço de forma limpa em vez de insistir.

### 8.3 CLI de gestão (superfície mínima)
```
rsm install [--server URL]     # emparelha + instala e inicia o serviço
rsm status                     # estado do serviço, ligação ao servidor, política local ativa
rsm logs [-f]                  # atalho para journalctl --user -u rsm-relay
rsm pause | resume             # pausa local: o relay deixa de reclamar jobs (kill-switch local)
rsm restart
rsm policy show|edit           # política local (só restringe)
rsm uninstall                  # revoga o device token no servidor, para/desativa/remove a unit e apaga config
rsm run [--service]            # primeiro plano; usado pela unit e para debug
```
- **Não existem** comandos `rsm admin ...`, `rsm token ...`, `rsm bridge` nem qualquer comando que execute tools.
- `rsm pause` funciona mesmo offline (flag local), e o painel mostra o dispositivo como "pausado localmente".
- Saída humana por defeito, `--json` onde fizer sentido. Erros com próximo passo acionável.

### 8.4 Estado "armado"
O dispositivo só executa jobs quando **os três** são verdadeiros: `devices.enabled` (painel) **e** relay não pausado localmente **e** grant válido para o cliente que chamou. O servidor responde ao poll com `204/idle` se `enabled=false`; o MCP devolve "dispositivo desativado".

### 8.5 Política local (defesa em profundidade)
`~/.config/rsm/policy.json`: `allowed_dirs`, `blocked_commands`, `read_only`, `max_sessions`, `max_output_bytes`, `max_job_seconds`.
- **Permissões efetivas = interseção(servidor/grant, política local).** O servidor nunca pode alargar a política local.
- O servidor envia as permissões efetivas dentro de **cada job**; o relay **revalida** (não confia cegamente).
- Caminhos resolvidos com `fs.realpath` e verificação de prefixo (cuidado com symlinks, `..`, caminhos Windows).
- Defeito conservador: `allowed_dirs` = diretório de trabalho escolhido na instalação (pergunta ao utilizador), `read_only=false` mas terminal só se o grant o incluir.

### 8.6 Execução
- Mapa de sessões `session_id → child_process` com buffer circular, limite de sessões, matar tudo ao terminar.
- Limites de tamanho de leitura/escrita/resultado (truncar com aviso) e timeout por job.
- Aviso permanente no README e em `rsm install`: guardrails **não são sandbox**; para risco alto, corre o relay dentro de container/VM.

---

## 9. Ferramentas MCP (v1)

Todas aceitam `device` (nome/id; opcional se o cliente só tem grant para um dispositivo). Zod + `annotations` (`readOnlyHint`, `destructiveHint`).

| Categoria | Tool | Preset mínimo |
|---|---|---|
| Dispositivos | `list_devices` (só os que o grant cobre), `whoami`, `ping_device` | read_only |
| Ficheiros (leitura) | `read_file` (offset/length), `read_multiple_files`, `list_directory`, `get_file_info` | read_only |
| Pesquisa | `start_search`, `get_search_results`, `stop_search` | read_only |
| Ficheiros (escrita) | `write_file`, `edit_block` (old→new exato, falha se não for único), `create_directory`, `move_file` | read_write |
| Processos | `start_process`, `interact_with_process`, `read_process_output`, `list_sessions`, `terminate_session` | terminal |
| Sistema | `get_system_info`, `list_system_processes` | read_only |

**Nunca expor via MCP:** gestão de contas, grants, permissões, tokens, aprovações. Isso é exclusivo do painel.

Fluxo de cada call: validar (secção 7.7) → se a tool estiver em `require_approval_for`, job `awaiting_approval` até aprovação no painel → `queued` → relay executa → resultado → audit (tool, resumo de args, ok/erro; **sem conteúdo**).

---

## 10. Segurança (não-negociável)

- HTTPS apenas. Cookies `HttpOnly; Secure; SameSite=Lax`; CSRF no painel e no consentimento.
- Nada em claro na BD; comparações em tempo constante; segredos ≥ 256 bits.
- PKCE S256 obrigatório; códigos de uso único, TTL ≤ 10 min; `redirect_uri` exato; validar audience/`resource`.
- Rate limiting em Postgres (janela deslizante) para: login, signup, register, token, device poll, `/api/mcp` por utilizador/cliente.
- `user_code` do device flow: alfabeto sem ambiguidades, expiração ~10 min, limite de tentativas; mostrar no painel **o nome do dispositivo/OS** pedido para evitar aprovar emparelhamentos alheios.
- Zod em tudo; limites de tamanho de body; sanitizar nomes.
- Audit log só-INSERT; sem tokens, passwords, códigos OAuth ou conteúdo de ficheiros em logs.
- Role `admin` verificada no servidor a cada pedido; headers de segurança (CSP, nosniff, Referrer-Policy).
- **Prompt injection:** documenta que conteúdo de ficheiros/páginas pode manipular o modelo; recomenda preset mínimo, `require_approval_for` em terminal e expirações curtas nos grants.
- **Modelo de confiança** (como no RDC): quem controla a conta do painel ou o cliente de IA autorizado controla as máquinas concedidas → MFA recomendado.
- Relay sempre ligado = superfície permanente: por isso deny-by-default, kill-switch no painel **e** local, e política local restritiva.

---

## 11. Variáveis de ambiente

```
DATABASE_URL=                 # Neon
APP_URL=https://<projeto>.vercel.app
ADMIN_EMAIL=
ADMIN_PASSWORD=               # bootstrap; forçar troca no 1º login
SESSION_SECRET=               # ≥ 32 bytes aleatórios
SIGNUP_MODE=approval          # open | approval | invite_only
ACCESS_TOKEN_TTL=3600
JOB_TIMEOUT_SECONDS=50        # ajustar ao maxDuration do plano
RELAY_POLL_IDLE_SECONDS=20
RELAY_POLL_ACTIVE_SECONDS=1
RELAY_ACTIVE_WINDOW_MINUTES=5
```

---

## 12. Plano por fases (valida antes de avançar)

**Fase 1 — Base e painel mínimo.** Monorepo, Next.js, Drizzle+Neon, migrações, bootstrap admin, login/signup/aprovação.
*Aceite:* admin entra e aprova um `pending`; `pending` não acede a nada.

**Fase 2 — Relay + fila.** Device flow, `rsm install` (cria e inicia a unit systemd --user), long-poll `/api/relay/*`, polling adaptativo, `ping_device` e `list_directory` ponta a ponta com um PAT já com grant.
*Aceite:* após reboot (com linger) o relay volta sozinho; matar o processo → systemd reinicia; sem grant → acesso negado.

**Fase 3 — MCP completo.** Todas as tools, sessões de processo, pesquisa assíncrona, truncagem.
*Aceite:* MCP Inspector (`npx @modelcontextprotocol/inspector`) lista e executa tudo o que o grant permite e nada além.

**Fase 4 — Grants e painel de acesso.** Tabela `client_grants`, páginas Dispositivos/Clientes/Atividade, kill-switch por dispositivo, "Desconectar tudo", `rsm pause/resume`, política local (interseção).
*Aceite:* revogar um grant bloqueia a próxima chamada; `devices.enabled=false` e `rsm pause` bloqueiam independentemente; política local mais restrita vence o servidor.

**Fase 5 — OAuth 2.1 + consentimento.** Metadados, DCR, authorize com **seleção de dispositivos/preset/duração**, token+refresh com rotação, revogação, CORS, `WWW-Authenticate`.
*Aceite:* claude.ai, ChatGPT (Developer mode) e Claude Code ligam via OAuth e só enxergam os dispositivos escolhidos no consentimento.

**Fase 6 — Admin, aprovações humanas e endurecimento.** Tetos por utilizador, convites, audit, rate limit, `require_approval_for` com UI de aprovação, `SIGNUP_MODE`.
*Aceite:* `start_process` com aprovação exigida fica pendente até ser aprovado no painel; utilizador A não vê nada de B.

**Fase 7 — Compatibilidade e extras.** Snippets por cliente, testes com Gemini CLI/Cursor/VS Code e Grok/Qwen (via PAT), README com "Deploy to Vercel", macOS (launchd) e Windows (Task Scheduler), TOTP admin, login GitHub/Google.

---

## 13. Testes mínimos

- Unitários: PKCE, hash/verify de tokens, resolução de caminhos (symlink, `..`, Windows), interseção de políticas, rotação de refresh, geração da unit systemd (caminhos absolutos).
- Integração: fluxo OAuth com cliente DCR simulado; device flow; 2 relays concorrentes (`SKIP LOCKED` sem duplicar jobs).
- Segurança: **deny-by-default** (cliente autenticado sem grant → negado), grant de um dispositivo não vale para outro, utilizador `pending`/`suspended` bloqueado em todos os caminhos, PAT/grant revogado para de funcionar de imediato, device token não funciona em `/api/mcp` e vice-versa.
- E2E manual por cliente (Claude, ChatGPT, Gemini CLI, Cursor, VS Code) + checklist de reboot/linger do relay.

---

## 14. Critérios de aceitação finais

- [ ] Deploy Vercel + Neon só com o README, ≤ 5 min.
- [ ] `rsm install` emparelha e deixa o relay a correr como `systemctl --user`, sobrevivendo a reboot (com linger) e a crashes.
- [ ] **Nenhum** acesso sem grant explícito feito no painel; CLI sem qualquer capacidade de executar tools ou administrar.
- [ ] Kill-switch no painel e local (`rsm pause`) funcionam de imediato; "Desconectar tudo" idem.
- [ ] Admin aprova contas e define tetos; multiusuário isolado.
- [ ] Funciona com claude.ai, Claude Code e ChatGPT via OAuth; com Gemini CLI/Cursor/VS Code e ≥ 1 de Grok/Qwen via PAT.
- [ ] Sem segredos em claro; audit sem conteúdo sensível; consumo Vercel/Neon medido e documentado.

---

## 15. Regras de trabalho para ti (Claude Code)

1. Antes de cada fase, resume o plano em 5–10 linhas, executa, corre testes e indica o que ficou por validar.
2. Ambiguidades (nome do binário, `neodb`=Neon?, plano Vercel, alternativa de wake no 3.1): pergunta **uma vez**, agrupando; não bloqueies o resto.
3. Consulta sempre a documentação atual de MCP, Vercel, Neon, systemd e dos clientes — não uses a memória para formatos/limites.
4. Se algo exigir infra extra (Redis, WebSocket server, filas externas), propõe primeiro a alternativa em Postgres.
5. Se uma decisão alargar o acesso (nova tool, novo default permissivo, comando CLI que execute algo), **para e pergunta**: o princípio é deny-by-default e controlo exclusivo pelo painel.
6. Commits pequenos, um por entrega funcional. Nunca registes tokens, passwords, códigos OAuth ou conteúdo de ficheiros em logs.
