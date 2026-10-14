// Empacota a CLI num único ficheiro (sem dependências) e gera o SHA-256.
// Saída: apps/web/public/cli/{mortality.mjs,mortality.mjs.sha256,version}
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = join(root, "..", "..", "apps", "web", "public", "cli");
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [join(root, "src", "index.ts")],
  outfile: join(out, "mortality.mjs"),
  bundle: true, platform: "node", format: "esm", target: "node18", minify: false, legalComments: "none",
  banner: { js: "// mortality CLI — gerado por packages/cli/scripts/bundle.mjs" },
});

const file = readFileSync(join(out, "mortality.mjs"));
const sha = createHash("sha256").update(file).digest("hex");
writeFileSync(join(out, "mortality.mjs.sha256"), `${sha}  mortality.mjs\n`);
writeFileSync(join(out, "version"), JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version + "\n");
console.log(`CLI empacotada: ${file.length} bytes, sha256 ${sha.slice(0, 12)}…`);
