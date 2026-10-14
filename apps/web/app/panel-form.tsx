"use client";

import { useActionState, type ReactNode } from "react";
import type { PanelState } from "@/lib/panel-actions";

export function PanelForm({ action, children, submit, tokenLabel = "Token (mostrado uma única vez)" }: {
  action: (s: PanelState, f: FormData) => Promise<PanelState>;
  children: ReactNode;
  submit: string;
  tokenLabel?: string;
}) {
  const [state, run, pending] = useActionState(action, undefined);
  return (
    <form action={run} style={{ display: "grid", gap: 12 }}>
      {children}
      {state?.error && <p role="alert" style={{ color: "crimson", margin: 0 }}>{state.error}</p>}
      {state?.token && (
        <div style={{ border: "1px solid #888", padding: 12 }}>
          <strong>{tokenLabel}:</strong>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{state.token}</pre>
        </div>
      )}
      <button disabled={pending}>{pending ? "…" : submit}</button>
    </form>
  );
}
