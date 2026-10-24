import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

// Dependency-free so test tooling (e.g. Playwright seeding) can import it without Next's server-only guard.

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HKDF_SALT = "simplebudget/secrets";
const HKDF_INFO = "aes-256-gcm/settings/v1";

export interface SecretBox {
  encrypt(plain: string): string;
  decrypt(blob: string): string;
}

function deriveKey(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, HKDF_SALT, HKDF_INFO, 32));
}

/** AES-256-GCM with a key derived from `secret` via HKDF. Blob format: `v1:<base64url(iv|tag|ciphertext)>`. */
export function createSecretBox(secret: string): SecretBox {
  const key = deriveKey(secret);
  return {
    encrypt(plain) {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv("aes-256-gcm", key, iv);
      const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return `${VERSION}:${Buffer.concat([iv, tag, ct]).toString("base64url")}`;
    },
    decrypt(blob) {
      const [version, payload] = blob.split(":");
      if (version !== VERSION || !payload) throw new Error("Unsupported ciphertext format");
      const raw = Buffer.from(payload, "base64url");
      if (raw.length < IV_BYTES + TAG_BYTES) throw new Error("Ciphertext too short");
      const iv = raw.subarray(0, IV_BYTES);
      const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
      const ct = raw.subarray(IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      try {
        return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
      } catch {
        throw new Error("Decryption failed (wrong APP_SECRET or corrupted data)");
      }
    },
  };
}
