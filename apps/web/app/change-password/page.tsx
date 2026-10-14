import { redirect } from "next/navigation";
import { changePassword } from "@/lib/actions";
import { currentUser } from "@/lib/session";
import { Form } from "../form";

export default async function ChangePassword() {
  if (!(await currentUser())) redirect("/login");
  return (
    <main>
      <h1>Alterar password</h1>
      <Form action={changePassword} submit="Guardar">
        <input name="current" type="password" placeholder="Password atual" required autoComplete="current-password" />
        <input name="next" type="password" placeholder="Nova password (mín. 10)" required minLength={10} autoComplete="new-password" />
      </Form>
    </main>
  );
}
