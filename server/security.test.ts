import assert from "node:assert/strict";
import { test } from "node:test";

process.env.ARS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
const { decryptSecret, encryptSecret, hashToken, newAccessToken } = await import("./crypto.ts");
const { assertPublicHost, fetchPublicUrl, imageSize, isPrivateAddress } = await import("./assets.ts");
const { checkBaseUrl } = await import("./secrets.ts");

const alice = "00000000-0000-0000-0000-00000000000a";
const bob = "00000000-0000-0000-0000-00000000000b";

test("secrets round-trip and are bound to their owner", () => {
  const stored = encryptSecret("sk-ant-secret-value", alice);
  assert.match(stored, /^v1:/);
  assert.ok(!stored.includes("secret-value"));
  assert.equal(decryptSecret(stored, alice), "sk-ant-secret-value");
  // A ciphertext copied into another user's row must not decrypt.
  assert.throws(() => decryptSecret(stored, bob));
  // Tampering is detected.
  const raw = Buffer.from(stored.slice(3), "base64");
  raw[raw.length - 1] ^= 1;
  assert.throws(() => decryptSecret(`v1:${raw.toString("base64")}`, alice));
  // Same plaintext, different ciphertexts (random IV).
  assert.notEqual(encryptSecret("x", alice), encryptSecret("x", alice));
});

test("access tokens: random, prefixed, stored only as a hash", () => {
  const a = newAccessToken();
  const b = newAccessToken();
  assert.match(a.token, /^ars_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a.token, b.token);
  assert.equal(a.hash, hashToken(a.token));
  assert.ok(!a.hash.includes(a.token.slice(4, 12)));
  assert.equal(a.hint, `ars_…${a.token.slice(-4)}`);
});

test("private and internal addresses are refused", async () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
    assert.ok(isPrivateAddress(ip), ip);
  }
  for (const ip of ["1.1.1.1", "8.8.8.8", "2606:4700::1111"]) assert.ok(!isPrivateAddress(ip), ip);
  await assert.rejects(assertPublicHost("127.0.0.1"));
  await assert.rejects(assertPublicHost("[::1]"));
  await assert.rejects(assertPublicHost("localhost"));
  await assert.rejects(fetchPublicUrl(new URL("https://127.0.0.1/internal")));
});

test("provider base URLs must be public https", async () => {
  await assert.rejects(checkBaseUrl("http://api.openai.com/v1"));
  await assert.rejects(checkBaseUrl("https://127.0.0.1/v1"));
  await assert.rejects(checkBaseUrl("https://user:pass@example.com/v1"));
  await assert.rejects(checkBaseUrl("not a url"));
});

test("image sizes are read from file headers", () => {
  const png = Buffer.alloc(24);
  png.writeUInt32BE(640, 16);
  png.writeUInt32BE(480, 20);
  assert.deepEqual(imageSize(png, "png"), { width: 640, height: 480 });
  assert.deepEqual(imageSize(Buffer.from('<svg viewBox="0 0 1726 444"></svg>'), "svg"), { width: 1726, height: 444 });
  assert.deepEqual(imageSize(Buffer.alloc(3), "jpg"), {});
});
