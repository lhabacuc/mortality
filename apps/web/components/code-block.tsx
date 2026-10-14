import { CopyButton } from "./copy-button";

/** Bloco de código com botão de copiar (server component; o botão é cliente). */
export function CodeBlock({ children }: { children: string }) {
  return (
    <div className="codeblock">
      <pre>{children}</pre>
      <CopyButton text={children} />
    </div>
  );
}
