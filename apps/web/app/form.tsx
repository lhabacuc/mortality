"use client";

import { useActionState, type ReactNode } from "react";
import type { FormState } from "@/lib/actions";

export function Form({ action, children, submit }: {
  action: (s: FormState, f: FormData) => Promise<FormState>;
  children: ReactNode;
  submit: string;
}) {
  const [state, run, pending] = useActionState(action, undefined);
  return (
    <form action={run} style={{ display: "grid", gap: 12 }}>
      {children}
      {state?.error && <p role="alert" style={{ color: "crimson", margin: 0 }}>{state.error}</p>}
      <button disabled={pending}>{pending ? "…" : submit}</button>
    </form>
  );
}
