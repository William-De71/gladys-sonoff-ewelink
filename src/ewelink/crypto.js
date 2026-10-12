// -----------------------------------------------------------------------------
// eWeLink cryptography.
//
//   - LAN payloads of the devices on the stock eWeLink firmware are encrypted
//     with AES-128-CBC, the key being the MD5 of the device `devicekey` (the
//     "factory apikey" the cloud device list returns). DIY-mode devices talk in
//     clear text. Protocol ported from SonoffLAN (AlexxIT, MIT licence).
//   - The cloud API signs the requests made before login (OAuth token, e-mail
//     login, authorization page) with HMAC-SHA256 keyed by the App Secret.
// -----------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';

const NONCE_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function aesKey(devicekey) {
  return createHash('md5').update(devicekey, 'utf8').digest();
}

/**
 * Encrypt the `data` object of a LAN request.
 * @param {object} data - The command parameters.
 * @param {string} devicekey - The device key.
 * @param {Buffer} [iv] - 16 bytes, random by default (fixed in tests).
 * @returns {{ data: string, iv: string }} Base64 cipher text and IV.
 */
export function encryptPayload(data, devicekey, iv = randomBytes(16)) {
  const cipher = createCipheriv('aes-128-cbc', aesKey(devicekey), iv);
  const plain = Buffer.from(JSON.stringify(data), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { data: encrypted.toString('base64'), iv: iv.toString('base64') };
}

/**
 * Decrypt the `data` of a LAN message (mDNS TXT record or HTTP answer).
 * @param {string} data - Base64 cipher text.
 * @param {string} iv - Base64 IV.
 * @param {string} devicekey - The device key.
 * @returns {object} The device parameters ({} for an empty message).
 */
export function decryptPayload(data, iv, devicekey) {
  // The SPM-Main sends empty messages, the ZBBridge-U none at all.
  if (!data) {
    return {};
  }
  const decipher = createDecipheriv('aes-128-cbc', aesKey(devicekey), Buffer.from(iv, 'base64'));
  let text = Buffer.concat([
    decipher.update(Buffer.from(data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  // RF Bridge firmware bug: `{"rfList"="..."}` instead of a colon.
  if (text.startsWith('{"rf')) {
    text = text.replaceAll('"="', '":"');
  }
  // Some firmwares pad with 0x02 after the PKCS#7 padding.
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) === 2) {
    end -= 1;
  }
  text = text.slice(0, end);
  return JSON.parse(text);
}

/**
 * HMAC-SHA256 signature, base64: the `Authorization: Sign ...` header of the
 * unauthenticated cloud requests, and the `authorization` parameter of the
 * OAuth page.
 * @param {string} secret - The App Secret.
 * @param {string} message - The signed text (request body, or `clientId_seq`).
 * @returns {string} The base64 signature.
 */
export function sign(secret, message) {
  return createHmac('sha256', secret).update(Buffer.from(message, 'utf8')).digest('base64');
}

/**
 * Random alphanumeric nonce (eWeLink asks for 8 characters).
 * @param {number} [length] - Length.
 * @returns {string} The nonce.
 */
export function nonce(length = 8) {
  const bytes = randomBytes(length);
  let result = '';
  for (const byte of bytes) {
    result += NONCE_ALPHABET[byte % NONCE_ALPHABET.length];
  }
  return result;
}
