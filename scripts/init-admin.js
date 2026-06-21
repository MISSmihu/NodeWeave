// scripts/init-admin.js - NEXUS 建站脚本：创建首任站长 (owner)
// 用法: node scripts/init-admin.js
// 交互式输入用户名/邮箱/密码，PBKDF2 哈希后写入 D1

import { createInterface } from 'readline';
import { webcrypto } from 'crypto';

const ITERATIONS = 210000;
const HASH_LEN = 32;
const SALT_LEN = 16;

function buf2b64(buf) {
  return Buffer.from(buf).toString('base64');
}

async function hashPassword(password, salt) {
  const enc = new TextEncoder();
  const s = salt || webcrypto.getRandomValues(new Uint8Array(SALT_LEN));
  const keyMaterial = await webcrypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = await webcrypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: s, iterations: ITERATIONS, hash: 'SHA-256' },
    keyMaterial, HASH_LEN * 8
  );
  return `pbkdf2$${ITERATIONS}$${buf2b64(s)}$${buf2b64(derived)}`;
}

function generateId() {
  const chars = 'useandom26T198340PX75pxJACKVERYMINDBUSHWOLFGQZbfghjklqvwyzrict';
  const bytes = webcrypto.getRandomValues(new Uint8Array(16));
  let id = '';
  for (let i = 0; i < bytes.length; i++) id += chars[bytes[i] & 63];
  return id;
}

const rl = createInterface({ input: process.stdin, output: process.stdout });
function ask(q) { return new Promise(resolve => rl.question(q, resolve)); }

async function main() {
  console.log('╔══════════════════════════════════╗');
  console.log('║  NEXUS 建站脚本 · 创建首任站长   ║');
  console.log('╚══════════════════════════════════╝');
  console.log('');

  const username = await ask('用户名 (admin): ');
  const email = await ask('邮箱: ');
  const password = await ask('密码: ');
  const displayName = await ask('显示名称 (站长): ');

  const finalUsername = username || 'admin';
  const finalDisplay = displayName || '站长';

  if (!email || !password) {
    console.log('\n错误: 邮箱和密码不能为空');
    rl.close();
    process.exit(1);
  }

  const userId = 'u_owner_' + generateId();
  const now = Date.now();
  const pwdHash = await hashPassword(password);

  console.log('\n正在生成 SQL...\n');

  const sql = `
-- 创建首任站长 (owner)
INSERT INTO users(id, username, email, display_name, password_hash, role, email_verified, created_at, updated_at)
VALUES('${userId}', '${finalUsername}', '${email}', '${finalDisplay}', '${pwdHash}', 'owner', 1, ${now}, ${now});

-- 确保站点配置存在
INSERT OR IGNORE INTO site_config (id) VALUES (1);
`.trim();

  console.log(sql);
  console.log('\n---');
  console.log('请在终端中运行以下命令写入数据库:');
  console.log('');
  console.log(`  wrangler d1 execute nexus-db --remote --command="${sql.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`);
  console.log('');
  console.log('或保存以上 SQL 到文件后执行:');
  console.log('  wrangler d1 execute nexus-db --remote --file=scripts/init-admin.sql');
  console.log('');

  rl.close();
}

main().catch(e => { console.error(e); rl.close(); process.exit(1); });
