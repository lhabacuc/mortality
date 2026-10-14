import Link from "next/link";
import { login } from "@/lib/actions";
import { Form } from "../form";

export default async function Login({ searchParams }: { searchParams: Promise<{ registered?: string; next?: string }> }) {
  const { registered, next } = await searchParams;
  return (
    <main>
      <h1>Mortality</h1>
      {registered && <p>Conta criada. Aguarda aprovação do administrador, se aplicável.</p>}
      <Form action={login} submit="Entrar">
        {next && <input type="hidden" name="next" value={next} />}
        <input name="email" type="email" placeholder="Email" required autoComplete="email" />
        <input name="password" type="password" placeholder="Password" required autoComplete="current-password" />
      </Form>
      <p><Link href="/signup">Criar conta</Link></p>
    </main>
  );
}
