// api/level.js - 等级组 Lv0-Lv5 与声望
import { Hono } from 'hono';
import { ok } from './lib/response.js';

const level = new Hono();

const LEVELS = [
  { level: 0, name: '新人', minRep: 0, color: '#8a8aa8', icon: '◈', reward: '注册即得基础身份', permissions: ['每日最多回复 25 条', '浏览公开内容', '参与签到'] },
  { level: 1, name: '学徒', minRep: 50, color: '#7fff00', icon: '◉', reward: '解除新人每日发帖限制', permissions: ['不限量发帖/评论', '参与评分互动', '可获得普通成就徽章'] },
  { level: 2, name: '极客', minRep: 200, color: '#00f0ff', icon: '◇', reward: '解锁附件上传', permissions: ['上传帖子附件', '更高搜索/浏览额度', '可购买稀有徽章'] },
  { level: 3, name: '黑客', minRep: 500, color: '#9d00ff', icon: '◆', reward: '解锁主页高级装扮与悬赏', permissions: ['自定义头像/主页装扮', '发布悬赏问答', '更高打赏额度'] },
  { level: 4, name: '大师', minRep: 1500, color: '#ff003c', icon: '⬡', reward: '可申请创建板块', permissions: ['申请创建板块', '板块共建资格', '优先进入内容推荐池'] },
  { level: 5, name: '传奇', minRep: 5000, color: '#ffd700', icon: '★', reward: '传奇身份特效', permissions: ['名字特殊光效', '传奇徽章展示', '高权重内容推荐'] },
];

function getLevel(reputation) {
  let lv = LEVELS[0];
  for (const l of LEVELS) {
    if (reputation >= l.minRep) lv = l;
  }
  return lv;
}

function levelProgress(reputation) {
  const current = getLevel(reputation);
  const next = LEVELS.find(l => l.minRep > reputation) || null;
  const previousMin = current.minRep;
  const nextMin = next ? next.minRep : current.minRep;
  const span = Math.max(1, nextMin - previousMin);
  const gained = Math.max(0, reputation - previousMin);
  return {
    current,
    next,
    progress: next ? Math.min(100, Math.round((gained / span) * 100)) : 100,
    need: next ? Math.max(0, next.minRep - reputation) : 0,
  };
}

async function isLevelSystemEnabled(env) {
  try {
    const cfg = await env.DB.prepare('SELECT user_level_enabled FROM site_config WHERE id=1').first();
    return Number(cfg?.user_level_enabled ?? 1) !== 0;
  } catch (error) {
    return true;
  }
}

// GET /api/level/list - 等级列表
level.get('/list', (c) => ok(c, LEVELS));

// GET /api/level/:userId - 查等级
level.get('/:userId', async (c) => {
  const user = await c.env.DB.prepare('SELECT reputation FROM users WHERE id=?').bind(c.req.param('userId')).first();
  if (!user) {
    return ok(c, { reputation: 0, ...LEVELS[0], progress: 0, next_level: LEVELS[1] });
  }
  const info = levelProgress(user.reputation);
  return ok(c, {
    reputation: user.reputation,
    level: info.current.level,
    name: info.current.name,
    color: info.current.color,
    icon: info.current.icon,
    minRep: info.current.minRep,
    reward: info.current.reward,
    permissions: info.current.permissions,
    progress: info.progress,
    need: info.need,
    next_level: info.next ? { ...info.next, need: info.need } : null,
  });
});

export { level, getLevel, levelProgress, isLevelSystemEnabled, LEVELS };
