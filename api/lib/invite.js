// api/lib/invite.js - 邀请码校验与消耗工具

function normalizeInviteCode(code) {
  return String(code || '').trim().toUpperCase();
}

async function getInviteConfig(db) {
  try {
    const cfg = await db.prepare(
      'SELECT invite_code_required, user_invite_enabled, user_invite_monthly_limit FROM site_config WHERE id=1'
    ).first();
    return {
      invite_code_required: Number(cfg?.invite_code_required || 0) === 1,
      user_invite_enabled: cfg?.user_invite_enabled === undefined ? true : Number(cfg.user_invite_enabled || 0) === 1,
      user_invite_monthly_limit: Math.max(0, Number(cfg?.user_invite_monthly_limit || 9)),
    };
  } catch (error) {
    return { invite_code_required: false, user_invite_enabled: true, user_invite_monthly_limit: 9 };
  }
}

async function findInviteCode(db, rawCode) {
  const code = normalizeInviteCode(rawCode);
  if (!code) return null;
  const now = Date.now();

  const adminCode = await db.prepare(
    'SELECT code, created_by, max_uses, used_count, expires_at, status FROM invite_codes WHERE code=? AND status=? AND used_count < max_uses AND (expires_at IS NULL OR expires_at > ?)'
  ).bind(code, 'active', now).first();
  if (adminCode) {
    return { type: 'admin', code, inviter_id: adminCode.created_by || '', row: adminCode };
  }

  const userCode = await db.prepare(
    'SELECT code, inviter_id, used_by, status, expires_at, created_at FROM user_invite_codes WHERE code=? AND status=? AND used_by IS NULL AND (expires_at IS NULL OR expires_at > ?)'
  ).bind(code, 'active', now).first();
  if (userCode) {
    return { type: 'user', code, inviter_id: userCode.inviter_id || '', row: userCode };
  }

  return null;
}

async function consumeInviteCode(db, rawCode, usedByUserId) {
  const invite = await findInviteCode(db, rawCode);
  if (!invite) return null;
  const now = Date.now();

  let result;
  if (invite.type === 'admin') {
    result = await db.prepare(
      'UPDATE invite_codes SET used_count=used_count+1 WHERE code=? AND status=? AND used_count < max_uses AND (expires_at IS NULL OR expires_at > ?)'
    ).bind(invite.code, 'active', now).run();
  } else {
    result = await db.prepare(
      'UPDATE user_invite_codes SET used_by=?, status=?, used_at=? WHERE code=? AND status=? AND used_by IS NULL AND (expires_at IS NULL OR expires_at > ?)'
    ).bind(usedByUserId, 'used', now, invite.code, 'active', now).run();
  }

  if (!result?.success || Number(result.meta?.changes || 0) < 1) return null;

  try {
    await db.prepare('UPDATE users SET invite_code=?, updated_at=? WHERE id=?')
      .bind(invite.code, now, usedByUserId).run();
  } catch (error) {}

  return invite;
}

function monthStartTimestamp(now = Date.now()) {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), 1).getTime();
}

export { consumeInviteCode, findInviteCode, getInviteConfig, monthStartTimestamp, normalizeInviteCode };
