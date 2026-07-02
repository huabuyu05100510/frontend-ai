// ============================================================
// 零知识客户端加密
// AES-256-GCM 在浏览器内加密，服务端永远看不到明文
// 对标：ProtonDrive / Tresorit 零知识架构
// ============================================================

// 辅助：创建 TypedArray（兼容 TS strict BufferSource 类型）
function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const arr = new Uint8Array(n)
  crypto.getRandomValues(arr)
  return arr as Uint8Array<ArrayBuffer>
}

interface EncryptedFile {
  ciphertext: ArrayBuffer
  iv: Uint8Array<ArrayBuffer>
  encryptedKey: ArrayBuffer
  salt: Uint8Array<ArrayBuffer>
  authTag: Uint8Array<ArrayBuffer>
}

/** 生成文件加密密钥（每文件独立随机） */
export async function generateFileKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, true, ['encrypt'],
  )
}

/** 用密码派生主密钥（PBKDF2，100000 次迭代） */
export async function deriveMasterKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['wrapKey', 'unwrapKey'],
  )
}

/**
 * 加密文件
 * 1. 生成随机文件密钥（AES-256-GCM）
 * 2. 用文件密钥 + 随机 IV 加密内容
 * 3. 用主密钥 wrap 文件密钥
 * 4. 返回 ciphertext + wrapped key + IV + salt + authTag
 */
export async function encryptFile(
  plaintext: ArrayBuffer,
  password: string,
): Promise<EncryptedFile> {
  const fileKey = await generateFileKey()
  const iv = randomBytes(12)

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 }, fileKey, plaintext,
  )

  const ciphertext = encrypted.slice(0, encrypted.byteLength - 16)
  const authTag = new Uint8Array(encrypted.slice(encrypted.byteLength - 16)) as Uint8Array<ArrayBuffer>

  const salt = randomBytes(16)
  const masterKey = await deriveMasterKey(password, salt)
  const encryptedKey = await crypto.subtle.wrapKey('raw', fileKey, masterKey, {
    name: 'AES-GCM', iv: randomBytes(12), tagLength: 128,
  })

  return { ciphertext, iv, encryptedKey, salt, authTag }
}

/** 解密文件 */
export async function decryptFile(
  encrypted: EncryptedFile,
  password: string,
): Promise<ArrayBuffer> {
  const masterKey = await deriveMasterKey(password, encrypted.salt)

  const fileKey = await crypto.subtle.unwrapKey(
    'raw', encrypted.encryptedKey, masterKey,
    { name: 'AES-GCM', iv: encrypted.iv as BufferSource, tagLength: 128 },
    { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  )

  const fullCiphertext = new Uint8Array(encrypted.ciphertext.byteLength + 16)
  fullCiphertext.set(new Uint8Array(encrypted.ciphertext))
  fullCiphertext.set(encrypted.authTag, encrypted.ciphertext.byteLength)

  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: encrypted.iv as BufferSource, tagLength: 128 },
    fileKey, fullCiphertext as BufferSource,
  )
}

/** 流式加密（大文件，每 16KB 独立加密） */
export async function* encryptStream(
  stream: ReadableStream<Uint8Array>,
  password: string,
): AsyncGenerator<{ chunk: Uint8Array<ArrayBuffer>; iv: Uint8Array<ArrayBuffer> }> {
  const fileKey = await generateFileKey()
  const reader = stream.getReader()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const iv = randomBytes(12)
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, tagLength: 128 }, fileKey, value as BufferSource,
      ),
    ) as Uint8Array<ArrayBuffer>

    yield { chunk: encrypted, iv }
  }
}

/** 文件完整性校验 HMAC */
export async function fileHMAC(
  data: ArrayBuffer,
  password: string,
): Promise<Uint8Array<ArrayBuffer>> {
  const salt = randomBytes(16)
  const key = await deriveMasterKey(password, salt)
  const hmacKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    key, { name: 'HMAC', hash: 'SHA-256', length: 256 }, false, ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', hmacKey, data)
  return new Uint8Array(signature) as Uint8Array<ArrayBuffer>
}