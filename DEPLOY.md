# Deploy passo a passo (Vercel + Neon)

Conta Vercel usada: scope `42skillars-projects`. Substitui `<PROJETO>` pelo nome escolhido (ex.: `mortality-mcp`).

## 0. Antes de começar
- [ ] **Roda a password do role no Neon** (Console → Roles → Reset password) se a connection string foi partilhada fora do teu cofre.
- [ ] Decide `SIGNUP_MODE` público: `invite_only` (recomendado) ou `approval`.
- [ ] Hobby é **só uso não comercial**.

## 1. Criar e ligar o projeto (a partir da raiz do repositório)
```bash
vercel project add <PROJETO> --scope 42skillars-projects
vercel link --yes --project <PROJETO> --scope 42skillars-projects
```

## 2. Root Directory = `apps/web` (monorepo pnpm)
```bash
vercel api /v9/projects/<PROJETO> -X PATCH \
  -F rootDirectory=apps/web -F framework=nextjs -F sourceFilesOutsideRootDirectory=true \
  --scope 42skillars-projects
```

## 3. Variáveis (Production). Os segredos são pedidos de forma oculta, não ficam no histórico
```bash
openssl rand -base64 48 | vercel env add SESSION_SECRET production --scope 42skillars-projects
vercel env add DATABASE_URL production --scope 42skillars-projects      # cola a connection string pooled
printf 'invite_only' | vercel env add SIGNUP_MODE production --scope 42skillars-projects
printf '1' | vercel env add REQUIRE_ADMIN_TOTP production --scope 42skillars-projects   # opcional
```
- `APP_URL` é opcional: sem ele usa-se `VERCEL_PROJECT_PRODUCTION_URL` (domínio de produção, https).
  Se usares domínio próprio, define `APP_URL` com ele.
- **Não** definas `ADMIN_EMAIL`/`ADMIN_PASSWORD`: o admin já existe na BD.

## 4. Deploy
```bash
vercel deploy --prod --scope 42skillars-projects
```
O `vercel.json` corre `pnpm db:migrate` antes do build (migrações idempotentes).

## 5. Verificação (substitui `<URL>`)
```bash
curl -s <URL>/.well-known/oauth-protected-resource        # resource = <URL>/api/mcp
curl -s <URL>/.well-known/oauth-authorization-server      # issuer = <URL>
curl -si -X POST <URL>/api/mcp -d '{}' | head -5          # 401 + www-authenticate
curl -s -X POST <URL>/api/oauth/register -H 'content-type: application/json' \
  -d '{"client_name":"smoke","redirect_uris":["https://example.com/cb"]}'   # 201 + client_id
```

## 6. Relay → servidor de produção
```bash
node packages/cli/dist/index.js install --server <URL>      # aprova o código em <URL>/device
```

## 7. ChatGPT (web)
1. Settings → Connectors → Advanced → **Developer mode** (planos/admin podem restringir).
2. **Create**: nome `Mortality`, URL `<URL>/api/mcp`, autenticação **OAuth**.
3. ChatGPT regista-se (DCR) e abre `<URL>/oauth/authorize`: faz login, escolhe dispositivo, preset **Só leitura**, diretório de teste, duração **1 hora**.
4. Num chat com o conector ativo: *"lista os ficheiros de <diretório> no dispositivo X"*.
5. Para o teste de escrita: preset **Leitura e escrita**; para terminal: aprova no painel (`/approvals`).

## Reverter
`vercel rollback`, ou `vercel project remove <PROJETO>`; no relay `mortality uninstall`.
