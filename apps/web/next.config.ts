import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@mortality/shared"],
  async headers() {
    return [{
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "X-Frame-Options", value: "DENY" },
        // Sem `form-action`: o consentimento OAuth redireciona para o callback do cliente.
        ...(process.env.NODE_ENV === "production"
          ? [{ key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'" }]
          : []),
      ],
    }];
  },
};
export default config;
