# Mortality

Painel web + relay para dar a clientes de IA (Claude, ChatGPT, Gemini, Cursor, VS Code…) acesso **controlado e revogável**
às tuas máquinas, via [MCP](https://modelcontextprotocol.io). Open source, deploy em **Vercel + Neon**.

> **Princípio:** o painel web é o único plano de controlo. Nenhum cliente acede a nada por ter conta ou token:
> precisa de um **grant explícito (cliente × dispositivo)** dado no painel. Por defeito, **acesso negado**.
> A CLI `mortality` não executa tools nem fala MCP: só instala e gere o relay.

```
 Cliente MCP ──(OAuth/PAT)──▶ /api/mcp (Vercel) ──grant?──▶ job em Postgres (Neon)
                                                                 ▲ claim (SKIP LOCKED)
 Relay (systemd/launchd/Task Scheduler) ──poll outbound──▶ /api/relay/poll ──▶ executa ──▶ /api/relay/result
```

## Segurança — lê isto

- **Guardrails, não sandbox.** Restrições de diretórios e comandos bloqueados reduzem o risco mas **não isolam** o processo:
  o relay corre com as permissões do teu utilizador. Para risco alto corre o relay num container/VM.
- **Prompt injection.** Conteúdo de ficheiros ou páginas pode manipular o modelo. Usa o preset mínimo, aprovação humana
  em `start_process` e expirações curtas.
- **Modelo de confiança.** Quem controla a tua conta no painel (ou o cliente autorizado) controla as máquinas concedidas. Ativa o 2FA.
- Permissões efetivas = **interseção** (grant do servidor ∩ política local `~/.config/mortality/policy.json`); o servidor nunca alarga a política local.
- Tokens guardados só como hash SHA-256; segredos TOTP cifrados (AES-256-GCM); audit log sem conteúdo de ficheiros.

## Arranque local

```bash
pnpm install
cp .env.example apps/web/.env      # preenche DATABASE_URL, SESSION_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
pnpm db:migrate
pnpm dev                            # http://localhost:3000
```

Faz login com o admin (troca de password obrigatória) e emparelha um dispositivo:

```bash
pnpm --filter mortality build
node packages/cli/dist/index.js install --server http://localhost:3000
```

## Deploy (Vercel + Neon)

> **Não testado num deploy real** — a configuração segue a documentação de 2026-10-14.

1. Cria um projeto Neon e copia a connection string **pooled**.
2. Importa o repositório na Vercel com **Root Directory = `apps/web`** (ativa *Include source files outside of the Root Directory*, necessário para `packages/shared`).
3. Define as variáveis de `.env.example` (no mínimo `DATABASE_URL`, `APP_URL`, `SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`).
   `APP_URL` tem de ser o URL **público e definitivo**: é o `issuer` e o `resource` OAuth.
4. O `vercel.json` corre `pnpm db:migrate` antes do build (migrações idempotentes).
5. Abre o painel, entra com o admin e troca a password. Depois remove `ADMIN_PASSWORD` das variáveis.

**Planos (verificado na documentação em 2026-10-14):** Vercel Hobby é **só para uso não comercial**; inclui 1 000 000 invocações
e 4 h de Active CPU por mês; `maxDuration` até 300 s. Neon Free: 100 CU-h/mês, autosuspend fixo de 5 min.

### Consumo e custo do relay sempre ligado

Medido localmente (dev server → Neon us-east-2, RTT elevado) e calculado a partir dos limites acima:

| Item | Valor |
|---|---|
| Queries por poll idle | **3** (era 7 antes da otimização) |
| Latência de um poll idle | **~620 ms** (era ~1250 ms) — dominada pelo RTT até ao Neon |
| Polls/dia por dispositivo (idle 20 s) | 4 320 → **~130 000/mês** (≈13 % das invocações Hobby, **por dispositivo**) |
| Modo ativo | 1 poll/s durante 5 min após cada job (≤ 300 polls por rajada) |
| Primeira chamada após inatividade | ≤ intervalo idle (20 s) |

**Problema real:** um poll a cada 20 s é muito menor que o autosuspend de 5 min, logo o Neon **nunca suspende**.
0,25 CU × ~730 h ≈ **182 CU-h/mês**, contra 100 CU-h do Free (≈ 16 dias). Opções:

1. Plano pago do Neon (usa o que já está implementado).
2. **Sinal de "wake" num KV gerido** (ex.: Upstash Redis): o poll idle não toca na BD; só jobs a acordam. *Proposto, não implementado* — requer a tua decisão.
3. Parar o serviço quando não usas (`systemctl --user stop mortality-relay`).
4. Intervalo idle ≥ ~9 min (impraticável: latência).

Active CPU da Vercel **não foi medido** (precisa de um deploy real).

## Relay

| SO | Backend | Estado |
|---|---|---|
| Linux | `systemctl --user` | **testado** (install, kill -9 → reinício, pause, uninstall) |
| macOS | launchd (LaunchAgent) | geração do plist testada; **não executado em macOS** |
| Windows | Task Scheduler (ao iniciar sessão) | geração dos argumentos testada; **não executado em Windows** |

Em Linux, sem *linger* o relay só corre com sessão aberta: `loginctl enable-linger $USER` (o `install` avisa mas não executa).
Reiniciar o serviço mata as sessões de processo em curso.

```
mortality install --server URL   mortality status [--json]   mortality logs [-f]
mortality pause | resume         mortality restart           mortality policy show|edit
mortality uninstall              mortality run [--service]
```

## Ligar clientes

O painel (`/connect`) gera os snippets. Estado de compatibilidade:

| Cliente | Modo | Estado |
|---|---|---|
| MCP Inspector (CLI, HTTP) | PAT | **testado** |
| Cliente OAuth simulado (DCR + PKCE + refresh) | OAuth | **testado** (script + browser) |
| Claude.ai / Desktop (custom connector) | OAuth | esperado funcionar — *não testado contra o cliente real* |
| Claude Code | OAuth / PAT | esperado funcionar — configuração verificada na doc |
| ChatGPT (Developer mode) | OAuth | esperado funcionar — menus/planos variam; *não testado* |
| Gemini CLI | OAuth / PAT | esperado funcionar — verificada na doc |
| Cursor | OAuth / PAT | esperado funcionar — verificada na doc |
| VS Code (Copilot) | PAT (`inputs`) / OAuth | esperado funcionar — verificada na doc |
| Grok, Qwen, outros | PAT | depende de o cliente aceitar cabeçalhos num servidor MCP HTTP |

Os clientes cloud (Claude.ai, ChatGPT) exigem um servidor **acessível pela internet pública** (HTTPS).

## Variáveis de ambiente

Ver [`.env.example`](.env.example) (comentado).

## Testes

```bash
pnpm test                                  # web
pnpm --filter mortality test               # relay/CLI
node --experimental-strip-types --test packages/shared/src/index.test.ts
```

Cobertura: PKCE (vetor RFC 7636), HOTP/TOTP (vetores RFC 4226/6238), sessões, paths/symlinks, interseção de políticas,
blocklist, geração systemd/launchd/schtasks, tools do relay. Os fluxos OAuth, aprovações, tetos, convites, isolamento
entre utilizadores e 2FA foram validados com scripts e browser contra Neon real (não fazem parte do `pnpm test`).

## Não implementado

- **Login GitHub/Google** — precisa de credenciais OAuth tuas e de uma política de associação de contas; não foi
  implementado para não incluir código de autenticação sem o poder testar.
- Notificação (push/email) de aprovações pendentes.
- QR code no setup do TOTP (mostra a chave e o URI `otpauth://`).
