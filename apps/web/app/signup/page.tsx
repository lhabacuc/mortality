import Link from "next/link";
import { signup } from "@/lib/actions";
import { Form } from "../form";

export default async function Signup({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  return (
    <main className="narrow">
      <h1>Criar conta</h1>
      <Form action={signup} submit="Registar">
        {invite && <input type="hidden" name="invite" value={invite} />}
        <input name="name" placeholder="Nome" aria-label="Nome" required />
        <input name="email" type="email" placeholder="Email" aria-label="Email" required autoComplete="email" />
        <input name="password" type="password" placeholder="Password (mín. 10)" aria-label="Password" required minLength={10} autoComplete="new-password" />
      </Form>
      <p><Link href="/login">Já tenho conta</Link></p>
    </main>
  );
}
