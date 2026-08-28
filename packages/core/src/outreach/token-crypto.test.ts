import { describe, expect, it } from "vitest";
import { encryptToken, decryptToken } from "./token-crypto.ts";

const KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

describe("token crypto", () => {
  it("round-trips", () => {
    const secret = JSON.stringify({ access_token: "ya29.x", refresh_token: "1//y" });
    expect(decryptToken(encryptToken(secret, KEY), KEY)).toBe(secret);
  });

  it("ciphertext is non-deterministic (fresh IV per call)", () => {
    expect(encryptToken("x", KEY)).not.toBe(encryptToken("x", KEY));
  });

  it("tampering is detected", () => {
    const enc = Buffer.from(encryptToken("x", KEY), "base64");
    enc[enc.length - 1] = enc[enc.length - 1]! ^ 0xff;
    expect(() => decryptToken(enc.toString("base64"), KEY)).toThrow();
  });

  it("rejects a short key", () => {
    expect(() => encryptToken("x", "abcd")).toThrow(/32 bytes/);
  });
});
