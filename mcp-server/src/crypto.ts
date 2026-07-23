import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";

export type EncryptedValue = {
  nonce: string;
  ciphertext: string;
  tag: string;
};

function deriveKey(masterKey: Buffer, label: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", masterKey, Buffer.alloc(0), Buffer.from(label, "utf8"), 32),
  );
}

function encrypt(key: Buffer, plaintext: string, aad: string): EncryptedValue {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return {
    nonce: nonce.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

function decrypt(key: Buffer, value: EncryptedValue, aad: string): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(value.nonce, "base64"),
  );
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(value.tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export class AtRestCrypto {
  private readonly draftKey: Buffer;
  private readonly searchEncryptionKey: Buffer;
  private readonly searchHmacKey: Buffer;
  private readonly caseInsensitivePaths: boolean;

  constructor(masterKey: Buffer, caseInsensitivePaths = false) {
    if (masterKey.byteLength !== 32) throw new Error("MCP 主密钥必须恰好为 32 bytes");
    this.draftKey = deriveKey(masterKey, "mini-canvas/drafts/v1");
    this.searchEncryptionKey = deriveKey(masterKey, "mini-canvas/search/encryption/v1");
    this.searchHmacKey = deriveKey(masterKey, "mini-canvas/search/hmac/v1");
    this.caseInsensitivePaths = caseInsensitivePaths;
  }

  encryptDraft(value: string, aad: string): EncryptedValue {
    return encrypt(this.draftKey, value, aad);
  }

  decryptDraft(value: EncryptedValue, aad: string): string {
    return decrypt(this.draftKey, value, aad);
  }

  encryptSearch(value: string, aad: string): EncryptedValue {
    return encrypt(this.searchEncryptionKey, value, aad);
  }

  decryptSearch(value: EncryptedValue, aad: string): string {
    return decrypt(this.searchEncryptionKey, value, aad);
  }

  searchTerm(tenantId: string, term: string): string {
    return createHmac("sha256", this.searchHmacKey)
      .update(`tenant\0${tenantId}\0term\0${term}`, "utf8")
      .digest("hex");
  }

  documentId(tenantId: string, path: string): string {
    const canonicalPath = this.caseInsensitivePaths
      ? path.normalize("NFKC").toLowerCase()
      : path.normalize("NFKC");
    return createHmac("sha256", this.searchHmacKey)
      .update(`tenant\0${tenantId}\0document\0${canonicalPath}`, "utf8")
      .digest("hex");
  }
}
