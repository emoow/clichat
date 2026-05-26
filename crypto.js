// 端到端加密工具：Node 18+ 和浏览器都用 globalThis.crypto.subtle，API 全 async。
// PSK = 32 字节随机，base64url 编码后塞进 wss URL 的 fragment (#k=...)。
// 密文格式: base64url(nonce[12] ‖ ciphertext ‖ tag[16])，作为单字符串放进 msg.content。

const subtle = globalThis.crypto?.subtle;
if (!subtle) {
  throw new Error('globalThis.crypto.subtle unavailable — Node 18+ or modern browser required');
}

const NONCE_LEN = 12;

function b64urlEncode(bytes) {
  let s;
  if (typeof Buffer !== 'undefined') {
    s = Buffer.from(bytes).toString('base64');
  } else {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    s = btoa(bin);
  }
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str) {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/') + pad;
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(b64, 'base64'));
  }
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(keyBytes) {
  return subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encrypt(plaintext, keyBytes) {
  const key = await importKey(keyBytes);
  const nonce = globalThis.crypto.getRandomValues(new Uint8Array(NONCE_LEN));
  const data = new TextEncoder().encode(plaintext);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, data));
  const out = new Uint8Array(NONCE_LEN + ct.length);
  out.set(nonce, 0);
  out.set(ct, NONCE_LEN);
  return b64urlEncode(out);
}

export async function decrypt(ciphertext, keyBytes) {
  const buf = b64urlDecode(ciphertext);
  if (buf.length < NONCE_LEN + 16) throw new Error('ciphertext too short');
  const nonce = buf.subarray(0, NONCE_LEN);
  const body = buf.subarray(NONCE_LEN);
  const key = await importKey(keyBytes);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, body);
  return new TextDecoder().decode(pt);
}

// 输入 server URL 字符串，输出 { cleanUrl, keyBytes }。fragment 缺失或无效则抛错。
export function parsePskFromUrl(urlString) {
  const u = new URL(urlString);
  const hash = u.hash.startsWith('#') ? u.hash.slice(1) : u.hash;
  if (!hash) throw new Error('server URL 没有带 PSK fragment (#k=...)');
  const params = new URLSearchParams(hash);
  const k = params.get('k');
  if (!k) throw new Error('fragment 里找不到 k=...');
  const keyBytes = b64urlDecode(k);
  if (keyBytes.length !== 32) throw new Error(`PSK 长度应为 32 字节，实际 ${keyBytes.length}`);
  u.hash = '';
  return { cleanUrl: u.toString(), keyBytes };
}

export function generatePskB64url() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return b64urlEncode(bytes);
}
