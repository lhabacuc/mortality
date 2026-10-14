import { redirect } from "next/navigation";
import { verify2fa } from "@/lib/actions";
import { readPending } from "@/lib/session";
import { Form } from "../../form";

export default async function TwoFactor({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (!(await readPending())) redirect("/login");
  return (
    <main>
      <h1>Verificação em dois passos</h1>
      <p>Introduz o código da tua app de autenticação ou um código de recuperação.</p>
      <Form action={verify2fa} submit="Verificar">
        {next && <input type="hidden" name="next" value={next} />}
        <input name="code" placeholder="123456 ou XXXXX-XXXXX" required autoComplete="one-time-code" inputMode="text" maxLength={11} autoFocus />
      </Form>
      <p><a href="/login">Cancelar</a></p>
    </main>
  );
}
