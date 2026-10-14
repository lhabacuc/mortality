/**
 * URL público canónico (issuer OAuth e `resource`). Ordem:
 * 1. APP_URL (explícito); 2. domínio de produção da Vercel; 3. origem do pedido; 4. localhost.
 */
export function appUrl(requestOrigin?: string): string {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
  return (requestOrigin ?? "http://localhost:3000").replace(/\/$/, "");
}
