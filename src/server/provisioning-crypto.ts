import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, type KeyObject } from "node:crypto";

/**
 * Sealing for credentials sent by the ERP to the storefront registry (docs/provisioning-protocol.md).
 *
 * X25519 ECDH between an ephemeral sender key and the storefront's static key, HKDF-SHA256, then
 * AES-256-GCM. The info and the additional data bind the ciphertext to one website, one key id and
 * one revision, so it cannot be replayed onto another website or an older revision. Every step has a
 * native PHP equivalent (sodium_crypto_scalarmult, hash_hkdf, openssl_encrypt aes-256-gcm).
 */
export type Sealed = { epk: string; iv: string; ct: string; tag: string };

const PROTOCOL = "banij-storefront-provisioning-v1";

export function bindingOf(websiteId: string, keyId: string, revision: number): string {
  return `${websiteId}|${keyId}|${revision}`;
}

export function rawPublicKey(key: KeyObject): Buffer {
  const jwk = key.export({ format: "jwk" }) as { x?: string };
  if (!jwk.x) {
    throw new Error("not an X25519 key");
  }
  return Buffer.from(jwk.x, "base64url");
}

export function publicKeyFromRaw(raw: Buffer): KeyObject {
  if (raw.length !== 32) {
    throw new Error("X25519 public key must be 32 bytes");
  }
  return createPublicKey({ key: { kty: "OKP", crv: "X25519", x: raw.toString("base64url") }, format: "jwk" });
}

export function privateKeyFromBase64(der: string): KeyObject {
  const key = createPrivateKey({ key: Buffer.from(der, "base64"), format: "der", type: "pkcs8" });
  if (key.asymmetricKeyType !== "x25519") {
    throw new Error("provisioning private key must be X25519");
  }
  return key;
}

function deriveKey(shared: Buffer, epk: Buffer, recipient: Buffer, binding: string): Buffer {
  const salt = Buffer.concat([epk, recipient]);
  return Buffer.from(hkdfSync("sha256", shared, salt, Buffer.from(`${PROTOCOL}|${binding}`, "utf8"), 32));
}

/** What the ERP does. Used here by the reference sender and the tests. */
export function seal(plaintext: string, recipientPublic: KeyObject, binding: string): Sealed {
  const ephemeral = generateKeyPairSync("x25519");
  const epk = rawPublicKey(ephemeral.publicKey);
  const shared = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipientPublic });
  const key = deriveKey(shared, epk, rawPublicKey(recipientPublic), binding);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(binding, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { epk: epk.toString("base64url"), iv: iv.toString("base64url"), ct: ct.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
}

export function open(sealed: Sealed, recipientPrivate: KeyObject, binding: string): string {
  const epk = Buffer.from(sealed.epk, "base64url");
  const iv = Buffer.from(sealed.iv, "base64url");
  const tag = Buffer.from(sealed.tag, "base64url");
  if (epk.length !== 32 || iv.length !== 12 || tag.length !== 16) {
    throw new Error("malformed sealed secret");
  }
  const shared = diffieHellman({ privateKey: recipientPrivate, publicKey: publicKeyFromRaw(epk) });
  const recipient = rawPublicKey(createPublicKey(recipientPrivate));
  const key = deriveKey(shared, epk, recipient, binding);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(binding, "utf8"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(sealed.ct, "base64url")), decipher.final()]).toString("utf8");
}
