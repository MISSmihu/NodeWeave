// api/lib/password.js - PBKDF2-SHA256 密码哈希
// 格式: pbkdf2$iterations$base64(salt)$base64(hash)

const ITERATIONS = 100000;
const HASH_LEN = 32;
const SALT_LEN = 16;

function buf2b64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function b642buf(str) {
  const raw = atob(str);
  const buf = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
  return buf;
}

async function hashPassword(password, providedSalt) {
  const iterations = ITERATIONS;
  const enc = new TextEncoder();
  const salt = providedSalt || crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial, HASH_LEN * 8
  );
  return `pbkdf2$${iterations}$${buf2b64(salt)}$${buf2b64(derived)}`;
}

async function verifyPassword(password, stored) {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  if (!Number.isSafeInteger(iterations) || iterations < 10000 || iterations > 210000) return false;
  const salt = b642buf(parts[2]);
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial, HASH_LEN * 8
  );
  return stored === `pbkdf2$${iterations}$${parts[2]}$${buf2b64(derived)}`;
}

export { hashPassword, verifyPassword };
