import { describe, expect, it } from "vitest";
import { createSecretBox, decrypt, encrypt } from "@/lib/crypto";

const SECRET = "a-very-long-secret-value-0123456789abcdef";

describe("crypto", () => {
  it("round-trips, including unicode and empty strings", () => {
    const box = createSecretBox(SECRET);
    for (const s of ["https://user:pass@bridge.simplefin.org/simplefin", "", "héllo ✓ 💸"]) {
      expect(box.decrypt(box.encrypt(s))).toBe(s);
    }
  });

  it("uses a fresh IV each time and never leaks the plaintext", () => {
    const box = createSecretBox(SECRET);
    const a = box.encrypt("secret-access-url");
    const b = box.encrypt("secret-access-url");
    expect(a).not.toBe(b);
    expect(a.startsWith("v1:")).toBe(true);
    expect(a).not.toContain("secret-access-url");
  });

  it("rejects tampered ciphertext", () => {
    const box = createSecretBox(SECRET);
    const blob = box.encrypt("hello");
    const raw = Buffer.from(blob.slice(3), "base64url");
    raw[raw.length - 1] ^= 1;
    expect(() => box.decrypt(`v1:${raw.toString("base64url")}`)).toThrow(/Decryption failed/);
  });

  it("rejects a different secret", () => {
    const blob = createSecretBox(SECRET).encrypt("hello");
    expect(() => createSecretBox(SECRET + "x").decrypt(blob)).toThrow(/Decryption failed/);
  });

  it("rejects malformed blobs", () => {
    const box = createSecretBox(SECRET);
    expect(() => box.decrypt("garbage")).toThrow();
    expect(() => box.decrypt("v2:abcd")).toThrow();
    expect(() => box.decrypt("v1:abcd")).toThrow(/too short/);
  });

  it("default helpers use APP_SECRET from the environment", () => {
    expect(decrypt(encrypt("x"))).toBe("x");
  });
});
