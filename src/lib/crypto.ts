import "server-only";
import { createSecretBox, type SecretBox } from "./secret-box";
import { getEnv } from "./env";

export { createSecretBox, type SecretBox };

let box: SecretBox | undefined;
let boxSecret: string | undefined;

function defaultBox(): SecretBox {
  const secret = getEnv().APP_SECRET;
  if (!box || boxSecret !== secret) {
    box = createSecretBox(secret);
    boxSecret = secret;
  }
  return box;
}

export function encrypt(plain: string): string {
  return defaultBox().encrypt(plain);
}

export function decrypt(blob: string): string {
  return defaultBox().decrypt(blob);
}
