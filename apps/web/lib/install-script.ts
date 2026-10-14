/** Origem segura para embutir num script de shell (sem aspas, espaços nem metacaracteres). */
export function safeOrigin(o: string): string | null {
  return /^https?:\/\/[A-Za-z0-9.\-]+(:\d{1,5})?$/.test(o) ? o : null;
}

/** Instalador `curl -fsSL <origem>/install | bash`: pequeno, legível e sem segredos. */
export function installScript(origin: string): string {
  return `#!/usr/bin/env bash
# Mortality CLI — instalador servido por ${origin}
# Inspeciona antes de executar:  curl -fsSL ${origin}/install
set -euo pipefail

ORIGIN='${origin}'
PREFIX="\${MORTALITY_HOME:-\$HOME/.local/share/mortality}"
BIN_DIR="\${MORTALITY_BIN:-\$HOME/.local/bin}"

say() { printf '%s\\n' "$*"; }
die() { printf 'Erro: %s\\n' "$*" >&2; exit 1; }

if [ "\${1:-}" = "--uninstall" ]; then
  say "A remover a CLI (corre 'mortality uninstall' antes, para revogar o dispositivo e parar o serviço)."
  rm -f "$BIN_DIR/mortality" "$PREFIX/mortality.mjs"
  rmdir "$PREFIX" 2>/dev/null || true
  say "Removida."
  exit 0
fi

# 1. requisitos
command -v node >/dev/null 2>&1 || die "Node.js >= 18 é necessário (https://nodejs.org)."
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 18 ] || die "Node.js $major é demasiado antigo; precisas de >= 18."

if command -v curl >/dev/null 2>&1; then
  dl() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  dl() { wget -qO "$2" "$1"; }
else
  die "curl ou wget é necessário."
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha() { sha256sum "$1" | cut -d' ' -f1; }
elif command -v shasum >/dev/null 2>&1; then
  sha() { shasum -a 256 "$1" | cut -d' ' -f1; }
else
  die "sha256sum ou shasum é necessário para verificar o download."
fi

# 2. descarregar e verificar
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
dl "$ORIGIN/cli/mortality.mjs" "$tmp/mortality.mjs"
dl "$ORIGIN/cli/mortality.mjs.sha256" "$tmp/mortality.sha256"
expected=$(cut -d' ' -f1 "$tmp/mortality.sha256")
actual=$(sha "$tmp/mortality.mjs")
[ -n "$expected" ] && [ "$expected" = "$actual" ] || die "checksum inválido; a instalação foi cancelada."

# 3. instalar (tudo dentro do teu HOME; não usa sudo)
mkdir -p "$PREFIX" "$BIN_DIR"
cp "$tmp/mortality.mjs" "$PREFIX/mortality.mjs"
cat > "$BIN_DIR/mortality" <<LAUNCHER
#!/bin/sh
MORTALITY_SERVER="\\\${MORTALITY_SERVER:-$ORIGIN}" exec node "$PREFIX/mortality.mjs" "\\$@"
LAUNCHER
chmod +x "$BIN_DIR/mortality"

say "mortality instalado em $BIN_DIR/mortality"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) say "Aviso: $BIN_DIR não está no PATH. Adiciona:  export PATH=\\"$BIN_DIR:\\$PATH\\"" ;;
esac

# 4. emparelhar (só com confirmação explícita e terminal interativo)
if (: < /dev/tty) 2>/dev/null; then
  printf 'Emparelhar este computador com %s agora? [S/n] ' "$ORIGIN" > /dev/tty
  read -r ans < /dev/tty || ans="n"
  case "\${ans:-S}" in
    [sSyY]*|"") exec "$BIN_DIR/mortality" install < /dev/tty ;;
  esac
fi
say "Próximo passo:  mortality install"
`;
}
