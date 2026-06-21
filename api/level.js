// api/level.js - 等级组 Lv0-Lv5 与声望
import { Hono } from 'hono';
import { ok } from './lib/response.js';

const level = new Hono();

const LEVELS = [
  { level: 0, name: '新人',    minRep: 0,    color: '#8a8aa8', icon: '◈' },
  { level: 1, name: '学徒',    minRep: 50,   color: '#7fff00', icon: '◉' },
  { level: 2, name: '极客',    minRep: 200,  color: '#00f0ff', icon: '◇' },
  { level: 3, name: '黑客',    minRep: 500,  color: '#9d00ff', icon: '◆' },
  { level: 4, name: '大师',    minRep: 1500, color: '#ff003c', icon: '⬡' },
  { level: 5, name: '传奇',    minRep: 5000, color: '#ffd700', icon: '★' },
];

function getLevel(reputation) {
  let lv = LEVELS[0];
  for (const l of LEVELS) {
    if (reputation >= l.minRep) lv = l;
  }
  return lv;
}

// GET /api/level/:userId - 查等级
level.get('/:userId', async (c) => {
  const user = await c.env.DB.prepare('SELECT reputation FROM users WHERE id=?').bind(c.req.param('userId')).first();
  if (!user) {
    return ok(c, { reputation: 0, ...LEVELS[0] });
  }
  const lv = getLevel(user.reputation);
  const nextLv = LEVELS.find(l => l.minRep > user.reputation);
  return ok(c, {
    reputation: user.reputation,
    level: lv.level,
    name: lv.name,
    color: lv.color,
    icon: lv.icon,
    next_level: nextLv ? { level: nextLv.level, name: nextLv.name, need: nextLv.minRep - user.reputation } : null,
  });
});

// GET /api/level/list - 等级列表
level.get('/list', (c) => ok(c, LEVELS));

export { level, getLevel, LEVELS };
