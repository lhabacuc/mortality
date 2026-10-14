import { redirect } from "next/navigation";
import { currentUser } from "./session";

/** Utilizador ativo, com password já trocada; senão redireciona. */
export async function requireUser() {
  const u = await currentUser();
  if (!u || u.status !== "active") redirect("/login");
  if (u.mustChangePassword) redirect("/change-password");
  return u;
}

/** Papel `admin` verificado no servidor a cada pedido. */
export async function requireAdmin() {
  const u = await requireUser();
  if (u.role !== "admin") redirect("/dashboard");
  return u;
}
