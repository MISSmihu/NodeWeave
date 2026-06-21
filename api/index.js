﻿
// 首页 - 内嵌静态内容
app.get('/', (c) => c.html(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>NodeWeave // 赛博社区</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=JetBrains+Mono:wght@400;600&family=Noto+Sans+SC:wght@400;500;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css">
<link rel="manifest" href="manifest.json">
<meta name="theme-color" content="#0a0a0f">
<style>.spinner{display:inline-block}</style>
<style>
/* IP/天气组件 */
.widget-weather{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:18px;margin-bottom:16px;position:relative;overflow:hidden}
.widget-weather::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--cyan),var(--purple),var(--magenta))}
.weather-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:10px}
.weather-header .title{font-family:var(--font-display);font-size:13px;color:var(--cyan)}
.weather-header .location{font-family:var(--font-mono);font-size:10px;color:var(--text-mute)}
.weather-main{display:flex;align-items:center;gap:14px}
.weather-icon{font-size:42px;flex-shrink:0}
.weather-info{flex:1}
.weather-temp{font-family:var(--font-display);font-size:28px;color:var(--text);line-height:1}
.weather-desc{font-size:12px;color:var(--text-dim);margin-top:2px}
.weather-details{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px;padding-top:10px;border-top:1px solid var(--border)}
.weather-detail{display:flex;align-items:center;gap:6px;font-family:var(--font-mono);font-size:10px;color:var(--text-mute)}
.weather-detail .val{color:var(--text-dim)}
.weather-forecast{display:flex;gap:10px;margin-top:12px;padding-top:10px;border-top:1px solid var(--border);overflow-x:auto}
.forecast-day{text-align:center;min-width:50px}
.forecast-day .day{font-family:var(--font-mono);font-size:9px;color:var(--text-mute);margin-bottom:4px}
.forecast-day .icon{font-size:22px}
.forecast-day .temp{font-family:var(--font-mono);font-size:11px;color:var(--text-dim);margin-top:2px}
@keyframes weatherPulse{0%,100%{opacity:.06}50%{opacity:.12}}
.widget-weather .bg-dot{position:absolute;width:60px;height:60px;border-radius:50%;background:var(--cyan);opacity:.06;animation:weatherPulse 4s ease-in-out infinite}
.widget-weather .bg-dot:nth-child(2){top:10px;right:20px;width:30px;height:30px;animation-delay:2s}
</style>
</head>
<body>

<!-- 全局背景：网格 + 扫描线 -->
<div class="bg-grid"></div>
<div class="bg-scanlines"></div>
<div class="bg-glow"></div>

<!-- ===== 顶部导航 ===== -->
<header class="nav">
  <div class="nav-inner">
    <a href="index.html" class="logo">
      <span class="logo-mark">◈</span>
      <span class="logo-text">NE<span class="x">X</span>US</span>
      <span class="logo-sub">// CYBER COMMUNITY</span>
    </a>
    <nav class="nav-links">
      <a href="index.html" class="active">动态</a>
      <a href="boards.html">论坛</a>
      <a href="#">博客</a>
      <a href="shop.html">商城</a>
      <a href="achievements.html">成就</a>
    </nav>
    <div class="nav-search">
      <span class="search-ico">⌕</span>
      <input type="text" placeholder="搜索帖子 / 用户 / 标签..." id="navSearch" onkeydown="if(event.key==='Enter')location.href='search.html?q='+encodeURIComponent(this.value)">
      <kbd>/</kbd>
    </div>
    <div class="nav-actions">
      <button class="btn-ghost" onclick="location.href='login.html'">登录</button>
      <button class="btn-primary" onclick="location.href='editor.html'">+ 发帖</button>
    </div>
  </div>
</header>

<!-- ===== Hero 区 ===== -->
<section class="hero">
  <div class="hero-grid"></div>
  <div class="hero-content">
    <div class="hero-tag">
      <span class="dot"></span> SYSTEM ONLINE · 已连接 1,247 个节点
    </div>
    <h1 class="hero-title">
      <span class="glitch" data-text="未来已来">未来已来</span>
      <span class="hero-title-sub">只是尚未均匀分布</span>
    </h1>
    <p class="hero-desc">
      一个属于开发者、极客与创造者的赛博社区。在这里分享技术、记录思考、连接同频的灵魂。
    </p>
    <div class="hero-actions">
      <button class="btn-primary btn-lg" onclick="location.href='boards.html'">开始探索 →</button>
      <button class="btn-outline btn-lg" onclick="location.href='editor.html'">撰写文章</button>
    </div>
    <div class="hero-stats">
      <div class="stat">
        <div class="stat-num" id="statMembers">--</div>
        <div class="stat-label">活跃成员</div>
      </div>
      <div class="stat-divider"></div>
      <div class="stat">
        <div class="stat-num" id="statPosts">--</div>
        <div class="stat-label">技术讨论</div>
      </div>
      <div class="stat-divider"></div>
      <div class="stat">
        <div class="stat-num" id="statBlogs">--</div>
        <div class="stat-label">原创博客</div>
      </div>
    </div>
  </div>
</section>

<!-- ===== 主体布局 ===== -->
<main class="layout">

  <!-- 左侧：Feed 流 -->
  <section class="feed">
    <div class="feed-tabs">
      <button class="tab active">推荐</button>
      <button class="tab">最新</button>
      <button class="tab">热榜</button>
      <button class="tab">关注</button>
      <div class="tab-filter">
        <span>⚡ 实时更新</span>
      </div>
    </div>

    <!-- Feed 动态加载 -->
    <div id="feedContainer">
      <div style="text-align:center;padding:40px;color:var(--text-mute)">
        <div class="spinner" style="width:32px;height:32px;border:2px solid var(--border);border-top-color:var(--cyan);border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 16px"></div>
        加载中...
      </div>
    </div>
    <button class="btn-loadmore" id="btnLoadmore" onclick="loadMorePosts()" style="display:none">加载更多 ↓</button>
  </section>

  <!-- 右侧栏 -->
  <aside class="sidebar">

    <!-- IP归属 + 天气预报 -->
    <div class="widget-weather" id="weatherWidget">
      <div class="bg-dot"></div><div class="bg-dot"></div>
      <div class="weather-header">
        <span class="title">🌐 节点信息</span>
        <span class="location" id="ipLocation">定位中...</span>
      </div>
      <div class="weather-main">
        <div class="weather-icon" id="weatherIcon">--</div>
        <div class="weather-info">
          <div class="weather-temp" id="weatherTemp">--</div>
          <div class="weather-desc" id="weatherDesc">加载中...</div>
        </div>
      </div>
      <div class="weather-details">
        <div class="weather-detail">💧 湿度 <span class="val" id="wHumidity">--</span></div>
        <div class="weather-detail">🌬 风速 <span class="val" id="wWind">--</span></div>
        <div class="weather-detail">👁 能见度 <span class="val" id="wVis">--</span></div>
        <div class="weather-detail">🌡 体感 <span class="val" id="wFeels">--</span></div>
      </div>
      <div class="weather-forecast" id="weatherForecast"></div>
    </div>

    <!-- 个人卡片 / 登录引导 -->
    <div class="widget widget-join">
      <div class="widget-glow"></div>
      <div class="join-avatar">◈</div>
      <h3>加入赛博社区</h3>
      <p>注册后即可发帖、关注作者、收藏文章，并解锁成就系统。</p>
      <button class="btn-primary btn-block" onclick="location.href='login.html'">立即注册</button>
    </div>

    <!-- 热门话题 -->
    <div class="widget">
      <div class="widget-header">
        <span class="widget-title">🔥 热门话题</span>
        <span class="widget-sub">TRENDING</span>
      </div>
      <ul class="topic-list">
        <li><span style="color:var(--text-mute);font-size:13px">启动后端后加载...</span></li>
      </ul>
    </div>

    <!-- 活跃用户 -->
    <div class="widget">
      <div class="widget-header">
        <span class="widget-title">⚡ 本周活跃</span>
        <span class="widget-sub">LEADERBOARD</span>
      </div>
      <ul class="user-list">
            <li><span style="color:var(--text-mute);font-size:13px">启动后端后加载...</span></li>
          </ul>
    </div>

  </aside>
</main>

<!-- ===== 底部 ===== -->
<footer class="footer">
  <div class="footer-inner">
    <div class="footer-brand">
      <span class="logo-mark">◈</span> NE<span style="color:var(--magenta)">X</span>US
      <span class="footer-copy">© 2026 · 赛博社区 · 一切均按开源协议发布</span>
    </div>
    <div class="footer-links">
      <a href="#">关于</a>
      <a href="legal/terms.html">条款</a>
      <a href="legal/privacy.html">隐私</a>
      <a href="#">API</a>
      <a href="https://github.com" target="_blank">GitHub</a>
    </div>
    <div class="footer-tagline">// STAY CURIOUS · KEEP SHIPPING //</div>
  </div>
</footer>

<script src="script.js"></script>
<script>
var feedPage=1,feedSort='latest';
async function loadFeed(){
  var c=document.getElementById('feedContainer');
  try{
    var r=await fetch('/api/posts?page='+feedPage+'&pageSize=10&sort='+feedSort);
    var j=await r.json();
    if(j.code!==0||!j.data.posts){c.innerHTML='<p style="color:var(--text-mute);text-align:center;padding:40px">请先启动后端服务</p>';return;}
    if(!j.data.posts.length&&feedPage===1){c.innerHTML='<p style="color:var(--text-mute);text-align:center;padding:40px">暂无帖子，<a href="editor.html" style="color:var(--cyan)">发一篇</a>吧</p>';return;}
    var h=j.data.posts.map(function(p){
      var tags=(p.tags||[]).map(function(t){return'<span class="tag tag-cyan">#'+xh(t)+'</span>'}).join('');
      return'<article class="card" onclick="location.href=\'post.html?id='+p.id+'\'"><div class="card-body"><div class="card-meta">'+tags+'<span class="card-type">'+(p.type==='blog'?'博客':'帖子')+'</span> . <span>@'+xh(p.username||p.display_name)+'</span> . <span>'+timeAgo(p.created_at)+'</span></div><h2 class="card-title">'+xh(p.title)+'</h2><div class="card-footer"><span class="card-stat">👁 '+(p.view_count||0)+'</span><span class="card-stat">💬 '+(p.comment_count||0)+'</span><span class="card-stat">⭐ '+(p.like_count||0)+'</span></div></div></article>';
    }).join('');
    if(feedPage===1)c.innerHTML=h;else c.innerHTML+=h;
    document.getElementById('btnLoadmore').style.display=j.data.posts.length>=10?'':'none';
  }catch(e){if(feedPage===1)c.innerHTML='<p style="color:var(--text-mute);text-align:center;padding:40px">请先启动后端服务</p>';}
}
function loadMorePosts(){feedPage++;loadFeed();}
document.querySelectorAll('.feed-tabs .tab').forEach(function(t){
  t.addEventListener('click',function(){
    document.querySelectorAll('.feed-tabs .tab').forEach(function(x){x.classList.remove('active')});
    t.classList.add('active');feedPage=1;
    feedSort=t.textContent.trim()==='热榜'?'hot':'latest';
    loadFeed();
  });
});
function timeAgo(ts){var d=Date.now()-ts;if(d<3600000)return Math.floor(d/60000)+'分钟前';if(d<86400000)return Math.floor(d/3600000)+'小时前';return Math.floor(d/86400000)+'天前';}
function xh(s){var d=document.createElement('div');d.textContent=s||'';return d.innerHTML}
loadFeed();
</script>
<script>
async function loadWeather() {
  var lat, lon, loc = '';
  var locResults = [];

  // 并发查询多个IP定位服务，投票决定
  async function tryService(url, parser) {
    try {
      var r = await fetch(url); var d = await r.json();
      var parsed = parser(d);
      if (parsed.lat && parsed.lon) locResults.push(parsed);
    } catch(e) {}
  }

  await Promise.all([
    tryService('https://ipapi.co/json/', function(d){ return {lat:d.latitude,lon:d.longitude,loc:(d.city||'')+', '+(d.country_name||'')}; }),
    tryService('http://ip-api.com/json/?lang=zh-CN', function(d){ return {lat:d.lat,lon:d.lon,loc:(d.city||'')+', '+(d.country||'')}; }),
    tryService('https://api.ip.sb/geoip', function(d){ return {lat:d.latitude,lon:d.longitude,loc:(d.city||'')+', '+(d.country||'')}; })
  ]);

  if (locResults.length > 0) {
    // 取出现最多的位置
    var countMap = {};
    locResults.forEach(function(r){ var k=r.loc; countMap[k]=(countMap[k]||0)+1; });
    var best = Object.keys(countMap).sort(function(a,b){return countMap[b]-countMap[a]})[0];
    var bestR = locResults.find(function(r){return r.loc===best});
    lat = bestR.lat; lon = bestR.lon; loc = best;
  } else {
    loc = '定位失败';
  }

  document.getElementById('ipLocation').textContent = loc || '定位中...';
  if (!lat || !lon) { document.getElementById('weatherDesc').textContent = '无法获取位置'; return; }

  // 3. Open-Meteo 天气
  try {
    var wRes = await fetch('https://api.open-meteo.com/v1/forecast?latitude='+lat+'&longitude='+lon+'&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,visibility&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=4');
    var wData = await wRes.json();
    if (wData.current) {
      var cur = wData.current; var wmo = cur.weather_code;
      document.getElementById('weatherIcon').textContent = getWeatherIcon(wmo);
      document.getElementById('weatherTemp').textContent = cur.temperature_2m + '°C';
      document.getElementById('weatherDesc').textContent = getWeatherDesc(wmo);
      document.getElementById('wHumidity').textContent = cur.relative_humidity_2m + '%';
      document.getElementById('wWind').textContent = cur.wind_speed_10m + ' km/h';
      document.getElementById('wVis').textContent = (cur.visibility/1000).toFixed(1) + ' km';
      document.getElementById('wFeels').textContent = cur.apparent_temperature + '°C';
    }
    if (wData.daily) {
      var days = ['日','一','二','三']; var fcHtml = '';
      for (var i=0;i<Math.min(4,wData.daily.time.length);i++) {
        fcHtml += '<div class="forecast-day"><div class="day">周'+days[new Date(wData.daily.time[i]).getDay()]+'</div>'+
          '<div class="icon">'+getWeatherIcon(wData.daily.weather_code[i])+'</div>'+
          '<div class="temp">'+Math.round(wData.daily.temperature_2m_max[i])+'°/'+Math.round(wData.daily.temperature_2m_min[i])+'°</div></div>';
      }
      document.getElementById('weatherForecast').innerHTML = fcHtml;
    }
  } catch(e) { document.getElementById('weatherDesc').textContent = '天气获取失败'; }
}

function getWeatherIcon(code) {
  if (code===0) return '☀️';
  if (code<=3) return '🌤️';
  if (code<=48) return '☁️';
  if (code<=57) return '🌧️';
  if (code<=67) return '🌧️';
  if (code<=77) return '❄️';
  if (code<=82) return '🌧️';
  if (code<=86) return '🌨️';
  if (code<=99) return '⛈️';
  return '🌡️';
}

function getWeatherDesc(code) {
  if (code===0) return '晴朗';
  if (code<=3) return '多云';
  if (code<=48) return '阴天';
  if (code<=57) return '小雨';
  if (code<=67) return '中雨';
  if (code<=77) return '小雪';
  if (code<=82) return '阵雨';
  if (code<=86) return '雨夹雪';
  if (code<=99) return '雷暴';
  return '未知';
}

loadWeather();
</script>
</body>
</html>
`));

// 静态页面路由
app.get('/:page.html', async (c) => {
  const page = c.req.param('page');
  const validPages = ['login','shop','achievements','profile','boards','board','post','editor','search','notifications','signin','forgot-password','verify-email'];
  if (!validPages.includes(page)) return c.notFound();
  // Return redirect to worker URL with full path
  return c.redirect(`/${page}.html`);
});
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


// 数据库自动迁移
async function runMigrations(db) {
  const migrations = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT,
      avatar_color TEXT DEFAULT '#00f0ff',
      bio TEXT DEFAULT '',
      role TEXT DEFAULT 'member',
      level INTEGER DEFAULT 0,
      reputation INTEGER DEFAULT 0,
      coins INTEGER DEFAULT 0,
      phone TEXT,
      phone_verified INTEGER DEFAULT 0,
      real_name TEXT,
      real_name_verified INTEGER DEFAULT 0,
      email_verified INTEGER DEFAULT 0,
      invite_code TEXT,
      profile_css TEXT DEFAULT '',
      profile_bg_type TEXT DEFAULT '',
      profile_bg_value TEXT DEFAULT '',
      blog_css TEXT DEFAULT '',
      blog_bg_type TEXT DEFAULT '',
      blog_bg_value TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      board_id TEXT DEFAULT 'general',
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      type TEXT DEFAULT 'post',
      hidden_content TEXT DEFAULT '',
      hidden_type TEXT DEFAULT 'none',
      hidden_until INTEGER DEFAULT 0,
      like_count INTEGER DEFAULT 0,
      comment_count INTEGER DEFAULT 0,
      tip_count INTEGER DEFAULT 0,
      view_count INTEGER DEFAULT 0,
      bounty INTEGER DEFAULT 0,
      bounty_claimed INTEGER DEFAULT 0,
      custom_css TEXT DEFAULT '',
      custom_bg_type TEXT DEFAULT '',
      custom_bg_value TEXT DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL,
      parent_id TEXT,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      like_count INTEGER DEFAULT 0,
      is_accepted INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS boards (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      color TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      created_by TEXT,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS site_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS invite_codes (
      code TEXT PRIMARY KEY,
      created_by TEXT,
      used_by TEXT,
      used INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      used_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS oauth_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_uid TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      avatar TEXT DEFAULT '',
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS verification_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS moderation_queue (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      item_type TEXT NOT NULL,
      author_id TEXT NOT NULL,
      title TEXT DEFAULT '',
      excerpt TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      ai_verdict TEXT DEFAULT '',
      ai_confidence REAL DEFAULT 0,
      reviewer_id TEXT,
      reviewed_at INTEGER,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS signins (
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      streak INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, date)
    )`,
    `CREATE TABLE IF NOT EXISTS badges (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      color TEXT DEFAULT '',
      rarity TEXT DEFAULT 'common',
      category TEXT DEFAULT 'general',
      price INTEGER DEFAULT 0,
      is_special INTEGER DEFAULT 0,
      quantity INTEGER DEFAULT -1,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS user_badges (
      user_id TEXT NOT NULL,
      badge_id TEXT NOT NULL,
      obtained_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, badge_id)
    )`,
    `CREATE TABLE IF NOT EXISTS achievements (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      icon TEXT DEFAULT '',
      condition_type TEXT NOT NULL,
      condition_value INTEGER DEFAULT 1,
      coin_reward INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS user_achievements (
      user_id TEXT NOT NULL,
      achievement_id TEXT NOT NULL,
      completed INTEGER DEFAULT 0,
      progress INTEGER DEFAULT 0,
      completed_at INTEGER,
      PRIMARY KEY (user_id, achievement_id)
    )`,
    `CREATE TABLE IF NOT EXISTS follows (
      follower_id TEXT NOT NULL,
      following_id TEXT NOT NULL,
      id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (follower_id, following_id)
    )`,
    `CREATE TABLE IF NOT EXISTS interactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL,
      action TEXT NOT NULL,
      value INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      ref_id TEXT DEFAULT '',
      actor_id TEXT DEFAULT '',
      message TEXT NOT NULL,
      is_read INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      post_id TEXT,
      file_name TEXT NOT NULL,
      file_size INTEGER DEFAULT 0,
      mime_type TEXT DEFAULT '',
      url TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS email_verification (
      user_id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`
  ];
  const existing = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='migrations'").first();
  if (!existing) {
    await db.prepare("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, executed_at INTEGER NOT NULL)").run();
  }
  for (const sql of migrations) {
    await db.prepare(sql).run();
  }
  console.log("Migrations checked - all tables exist");
}

let migrated = false;



const app = new Hono()

// Run migrations on first request
app.use('*', async (c, next) => {
  if (!migrated) {
    try {
      await runMigrations(c.env.DB);
      migrated = true;
    } catch (e) {
      console.error('Migration error:', e.message);
    }
  }
  await next();
});;
app.use('*', logger());
app.use('/api/*', cors({ origin: ['https://nodeweave.pages.dev', 'http://localhost:8080', 'http://127.0.0.1:8080'], credentials: true }));

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
