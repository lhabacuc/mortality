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
    <form action={run} className="stack">
      {children}
      {state?.error && <p role="alert" className="alert">{state.error}</p>}
      <div><button className="primary" disabled={pending}>{pending ? "A processar…" : submit}</button></div>
    </form>
  );
}
