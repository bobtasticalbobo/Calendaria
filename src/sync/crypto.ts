import { SyncError } from "./gist";
import type { Snapshot } from "./merge";

/**
 * The shared copy is encrypted on the device before it reaches GitHub:
 * AES-256-GCM with a key derived from the passphrase by PBKDF2-SHA-256.
 * The salt and iteration count travel with the data, so every device with
 * the passphrase can derive the same key. GCM also detects tampering and a
 * wrong passphrase.
 */
export interface Envelope {
  format: "calendaria-encrypted";
  version: 1;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  iv: string;
  data: string;
}

const ITERATIONS = 600_000;

export class WrongPassphraseError extends SyncError {
  constructor() {
    super("The passphrase doesn't match the one your other devices use.");
  }
}

function toBase64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

// Deriving the key is deliberately slow, so it is done once per passphrase and salt.
const keys = new Map<string, Promise<CryptoKey>>();

function deriveKey(passphrase: string, salt: string, iterations: number): Promise<CryptoKey> {
  const id = `${iterations}:${salt}:${passphrase}`;
  let key = keys.get(id);
  if (!key) {
    key = crypto.subtle
      .importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"])
      .then((material) =>
        crypto.subtle.deriveKey(
          { name: "PBKDF2", hash: "SHA-256", salt: fromBase64(salt), iterations },
          material,
          { name: "AES-GCM", length: 256 },
          false,
          ["encrypt", "decrypt"],
        ),
      );
    keys.set(id, key);
  }
  return key;
}

export function newSalt(): string {
  return toBase64(crypto.getRandomValues(new Uint8Array(16)));
}

export function isEnvelope(value: unknown): value is Envelope {
  return (value as Envelope | null)?.format === "calendaria-encrypted";
}

/** Encrypts with a fresh IV each time. Reusing the salt keeps the derived key cached. */
export async function encrypt(snapshot: Snapshot, passphrase: string, salt: string): Promise<Envelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(snapshot)),
  );
  return {
    format: "calendaria-encrypted",
    version: 1,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt },
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(data)),
  };
}

export async function decrypt(envelope: Envelope, passphrase: string): Promise<Snapshot> {
  const key = await deriveKey(passphrase, envelope.kdf.salt, envelope.kdf.iterations);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(envelope.iv) }, key, fromBase64(envelope.data));
  } catch {
    throw new WrongPassphraseError();
  }
  return JSON.parse(new TextDecoder().decode(plain)) as Snapshot;
}
