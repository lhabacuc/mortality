"use client";

import { useActionState, type ReactNode } from "react";
import type { PanelState } from "@/lib/panel-actions";
import { CopyButton } from "@/components/copy-button";

export function PanelForm({ action, children, submit, tokenLabel = "Mostrado uma única vez — guarda agora" }: {
  action: (s: PanelState, f: FormData) => Promise<PanelState>;
  children: ReactNode;
  submit: string;
  tokenLabel?: string;
}) {
  const [state, run, pending] = useActionState(action, undefined);
  return (
    <form action={run} className="stack">
      {children}
      {state?.error && <p role="alert" className="alert">{state.error}</p>}
      {state?.ok && <p role="status" className="success">{state.ok}</p>}
      {state?.token && (
        <div className="token">
          <p>{tokenLabel}</p>
          <div className="codeblock">
            <pre>{state.token}</pre>
            <CopyButton text={state.token} />
          </div>
        </div>
      )}
      <div><button className="primary" disabled={pending}>{pending ? "A processar…" : submit}</button></div>
    </form>
  );
}
