import { webcrypto } from "node:crypto";

const IV_LENGTH = 12;
const HKDF_SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 310_000;
const ENCRYPTED_PREFIX = "%=";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function decodePbkdf2Salt(base64: string): Uint8Array {
  const salt = Uint8Array.from(Buffer.from(base64, "base64"));
  if (salt.byteLength !== 32) {
    throw new Error(`LiveSync PBKDF2 salt 长度异常：${salt.byteLength} bytes`);
  }
  return salt;
}

export class LiveSyncV2Crypto {
  private masterKeyPromise?: Promise<CryptoKey>;
  private readonly passphrase: string;
  private readonly pbkdf2Salt: Uint8Array;

  constructor(passphrase: string, pbkdf2Salt: Uint8Array) {
    this.passphrase = passphrase;
    this.pbkdf2Salt = pbkdf2Salt;
  }

  private async masterKey(): Promise<CryptoKey> {
    this.masterKeyPromise ??= (async () => {
      const keyMaterial = await webcrypto.subtle.importKey(
        "raw",
        encoder.encode(this.passphrase),
        "PBKDF2",
        false,
        ["deriveKey"],
      );
      const aesKey = await webcrypto.subtle.deriveKey(
        {
          name: "PBKDF2",
          salt: this.pbkdf2Salt,
          iterations: PBKDF2_ITERATIONS,
          hash: "SHA-256",
        },
        keyMaterial,
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"],
      );
      const raw = await webcrypto.subtle.exportKey("raw", aesKey);
      return webcrypto.subtle.importKey("raw", raw, "HKDF", false, ["deriveKey"]);
    })();
    return this.masterKeyPromise;
  }

  private async deriveChunkKey(hkdfSalt: Uint8Array): Promise<CryptoKey> {
    return webcrypto.subtle.deriveKey(
      {
        name: "HKDF",
        salt: hkdfSalt,
        info: new Uint8Array(),
        hash: "SHA-256",
      },
      await this.masterKey(),
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
  }

  async decrypt(value: string): Promise<string> {
    if (!value.startsWith(ENCRYPTED_PREFIX)) {
      throw new Error("数据块不是 LiveSync V2 的 %= 加密格式");
    }
    const binary = Uint8Array.from(Buffer.from(value.slice(2), "base64"));
    if (binary.byteLength < IV_LENGTH + HKDF_SALT_LENGTH + 16) {
      throw new Error("LiveSync V2 密文长度异常");
    }
    const iv = binary.slice(0, IV_LENGTH);
    const hkdfSalt = binary.slice(IV_LENGTH, IV_LENGTH + HKDF_SALT_LENGTH);
    const encrypted = binary.slice(IV_LENGTH + HKDF_SALT_LENGTH);
    const plain = await webcrypto.subtle.decrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      await this.deriveChunkKey(hkdfSalt),
      encrypted,
    );
    return decoder.decode(plain);
  }

  async encrypt(value: string): Promise<string> {
    const iv = webcrypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const hkdfSalt = webcrypto.getRandomValues(new Uint8Array(HKDF_SALT_LENGTH));
    const encrypted = new Uint8Array(
      await webcrypto.subtle.encrypt(
        { name: "AES-GCM", iv, tagLength: 128 },
        await this.deriveChunkKey(hkdfSalt),
        encoder.encode(value),
      ),
    );
    const combined = new Uint8Array(
      iv.byteLength + hkdfSalt.byteLength + encrypted.byteLength,
    );
    combined.set(iv, 0);
    combined.set(hkdfSalt, iv.byteLength);
    combined.set(encrypted, iv.byteLength + hkdfSalt.byteLength);
    return `${ENCRYPTED_PREFIX}${Buffer.from(combined).toString("base64")}`;
  }
}
