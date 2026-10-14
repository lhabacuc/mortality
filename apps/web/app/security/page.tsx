import { requireUser } from "@/lib/guard";
import { beginTotp, confirmTotp, disableTotp } from "@/lib/totp-actions";
import { base32Encode, decryptSecret, otpauthUrl } from "@/lib/totp";
import { PanelForm } from "../panel-form";
import { CodeBlock } from "@/components/code-block";

export default async function Security() {
  const user = await requireUser();
  const setup = !user.totpEnabled && user.totpSecretEnc;
  const secretB32 = setup ? base32Encode(decryptSecret(user.totpSecretEnc!)) : null;
  return (
    <main>
      <h1>Segurança</h1>
      {process.env.REQUIRE_ADMIN_TOTP === "1" && user.role === "admin" && !user.totpEnabled && (
        <p role="alert" className="alert">Este servidor exige 2FA para administradores. Ativa-o para aceder à administração.</p>
      )}
      <h2>Autenticação em dois passos (TOTP)</h2>
      {user.totpEnabled ? (
        <>
          <p>Ativo. Códigos de recuperação restantes: <strong>{user.totpRecovery.length}</strong>.</p>
          <PanelForm action={disableTotp} submit="Desativar 2FA">
            <input name="password" type="password" aria-label="Password atual" placeholder="Password atual" required autoComplete="current-password" />
            <input name="code" aria-label="Código atual" placeholder="Código atual de 6 dígitos" required inputMode="numeric" maxLength={6} />
          </PanelForm>
        </>
      ) : setup ? (
        <>
          <p>1. Na tua app (Google Authenticator, Authy, 1Password…) adiciona uma conta manualmente com esta chave:</p>
          <CodeBlock>{secretB32!}</CodeBlock>
          <p>ou abre este URI no teu gestor: <code>{otpauthUrl("Mortality", user.email, secretB32!)}</code></p>
          <p>2. Confirma com o código de 6 dígitos:</p>
          <PanelForm action={confirmTotp} submit="Confirmar e ativar" tokenLabel="Códigos de recuperação (guarda-os agora; só aparecem uma vez)">
            <input name="code" aria-label="Código de 6 dígitos" placeholder="123456" required inputMode="numeric" maxLength={6} autoComplete="one-time-code" />
          </PanelForm>
        </>
      ) : (
        <form action={beginTotp}><button>Configurar 2FA</button></form>
      )}
          </main>
  );
}
