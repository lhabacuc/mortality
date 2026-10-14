import { redirect } from "next/navigation";
import { currentUser } from "./session";

/** Utilizador ativo, com password já trocada; senão redireciona. */
export async function requireUser() {
  const u = await currentUser();
  if (!u || u.status !== "active") redirect("/login");
  if (u.mustChangePassword) redirect("/change-password");
  return u;
}
