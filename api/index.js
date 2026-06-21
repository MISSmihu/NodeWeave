// api/index.js - Worker 入口，挂载所有路由
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { auth } from './auth.js';
import { oauth } from './oauth.js';
import { account } from './account.js';
import { posts } from './posts.js';
import { comments } from './comments.js';
import { level } from './level.js';
import { users } from './users.js';
import { coins } from './coins.js';
import { signin } from './signin.js';
import { badges } from './badges.js';
import { boardsRouter } from './boards.js';
import { achievementsRouter } from './achievements.js';
import { notificationsRouter } from './notifications.js';
import { followRouter } from './follow.js';
import { siteConfig } from './site-config.js';
import { inviteCodes } from './admin/invite-codes.js';
import { moderation } from './admin/moderation.js';
import { bans } from './admin/bans.js';
import { aiConfig } from './admin/ai-config.js';
import { siteConfigAdmin } from './admin/site-config-admin.js';

const app = new Hono();
app.use('*', logger());
app.use('/api/*', cors({ origin: ['https://nexus.pages.dev', 'http://localhost:8080', 'http://127.0.0.1:8080'], credentials: true }));

app.route('/api/auth', auth);
app.route('/api/oauth', oauth);
app.route('/api/account', account);
app.route('/api/posts', posts);
app.route('/api/comments', comments);
app.route('/api/level', level);
app.route('/api/users', users);
app.route('/api/coins', coins);
app.route('/api/signin', signin);
app.route('/api/badges', badges);
app.route('/api/boards', boardsRouter);
app.route('/api/achievements', achievementsRouter);
app.route('/api/notifications', notificationsRouter);
app.route('/api/follow', followRouter);
app.route('/api/site-config', siteConfig);
app.route('/api/admin/invite-codes', inviteCodes);
app.route('/api/admin/moderation', moderation);
app.route('/api/admin/bans', bans);
app.route('/api/admin/ai-config', aiConfig);
app.route('/api/admin/site-config', siteConfigAdmin);

app.get('/api/health', (c) => c.json({ code: 0, data: { status: 'online', time: Date.now() }, msg: 'ok' }));

export default app;
