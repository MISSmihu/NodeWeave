// api/lib/id.js - 简易 ID 生成器（仿 nanoid，无依赖）

const ALPHABET = 'useandom26T198340PX75pxJACKVERYMINDBUSHWOLFGQZbfghjklqvwyzrict';
const LEN = 16;

function generateId(size) {
  const bytes = crypto.getRandomValues(new Uint8Array(size || LEN));
  let id = '';
  for (let i = 0; i < bytes.length; i++) {
    id += ALPHABET[bytes[i] & 63];
  }
  return id;
}

export { generateId };
