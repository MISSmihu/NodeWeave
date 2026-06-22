// api/attachments.js - 附件上传
import { Hono } from 'hono';
import { authUser } from './lib/jwt.js';
import { generateId } from './lib/id.js';
import { ok, err, CODE } from './lib/response.js';

const attachmentsRouter = new Hono();

async function requireLogin(c, next) {
  const user = await authUser(c, c.env);
  if (!user) return err(c, CODE.UNAUTHORIZED, '请先登录', 401);
  c.set('userId', user.sub);
  return next();
}

function parseCloudinaryUrl(value) {
  if (!value) return null;
  const match = String(value).match(/^cloudinary:\/\/([^:]+):([^@]+)@(.+)$/);
  if (!match) return null;
  return { apiKey: match[1], apiSecret: match[2], cloudName: match[3] };
}

async function sha1Hex(text) {
  const buffer = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buffer)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function safeFileName(name) {
  return String(name || 'attachment')
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || 'attachment';
}

attachmentsRouter.post('/upload', requireLogin, async (c) => {
  const userId = c.get('userId');
  const config = parseCloudinaryUrl(c.env.CLOUDINARY_URL);
  if (!config) return err(c, CODE.SERVER_ERROR, '附件上传服务未配置', 500);

  const form = await c.req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return err(c, CODE.VALIDATION, '请选择要上传的文件');
  if (file.size <= 0) return err(c, CODE.VALIDATION, '文件为空');
  if (file.size > 20 * 1024 * 1024) return err(c, CODE.VALIDATION, '单个附件最大 20MB');

  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'nodeweave/attachments';
  const signature = await sha1Hex(`folder=${folder}&timestamp=${timestamp}${config.apiSecret}`);
  const uploadForm = new FormData();
  uploadForm.append('file', file, safeFileName(file.name));
  uploadForm.append('api_key', config.apiKey);
  uploadForm.append('timestamp', String(timestamp));
  uploadForm.append('folder', folder);
  uploadForm.append('signature', signature);

  const uploadResp = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudName}/auto/upload`, {
    method: 'POST',
    body: uploadForm,
  });
  const uploaded = await uploadResp.json().catch(() => ({}));
  if (!uploadResp.ok || !uploaded.secure_url) {
    return err(c, CODE.SERVER_ERROR, uploaded.error?.message || '附件上传失败', 502);
  }

  const attachmentId = 'att_' + generateId(10);
  await c.env.DB.prepare(
    'INSERT INTO attachments(id,user_id,post_id,file_name,file_size,mime_type,url,created_at) VALUES(?,?,?,?,?,?,?,?)'
  ).bind(
    attachmentId,
    userId,
    '',
    safeFileName(file.name),
    uploaded.bytes || file.size,
    file.type || uploaded.resource_type || '',
    uploaded.secure_url,
    Date.now()
  ).run();

  return ok(c, {
    id: attachmentId,
    url: uploaded.secure_url,
    file_name: safeFileName(file.name),
    file_size: uploaded.bytes || file.size,
    mime_type: file.type || '',
    resource_type: uploaded.resource_type || '',
  }, 201);
});

export { attachmentsRouter };
