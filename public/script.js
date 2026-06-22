/* ===== NodeWeave // 赛博社区 交互脚本 ===== */

// 数字滚动动画（统计数据）
function animateCount(el){
  const target = +el.dataset.target;
  const dur = 1800;
  const start = performance.now();
  function tick(now){
    const p = Math.min((now - start)/dur, 1);
    // easeOutCubic
    const eased = 1 - Math.pow(1 - p, 3);
    const val = Math.floor(eased * target);
    el.textContent = val.toLocaleString();
    if(p < 1) requestAnimationFrame(tick);
    else el.textContent = target.toLocaleString();
  }
  requestAnimationFrame(tick);
}

// 元素进入视口时触发
const io = new IntersectionObserver((entries)=>{
  entries.forEach(e=>{
    if(e.isIntersecting){
      animateCount(e.target);
      io.unobserve(e.target);
    }
  });
},{threshold:.4});

document.querySelectorAll('.stat-num[data-target]').forEach(el=>io.observe(el));

// 顶部导航 Tab 切换（Feed）
document.querySelectorAll('.feed-tabs .tab').forEach(tab=>{
  tab.addEventListener('click',()=>{
    document.querySelectorAll('.feed-tabs .tab').forEach(t=>t.classList.remove('active'));
    tab.classList.add('active');
  });
});

// 顶部导航链接切换
document.querySelectorAll('.nav-links a').forEach(a=>{
  a.addEventListener('click',(e)=>{
    document.querySelectorAll('.nav-links a').forEach(x=>x.classList.remove('active'));
    a.classList.add('active');
  });
});

// "/" 快捷键聚焦搜索
document.addEventListener('keydown',(e)=>{
  if(e.key === '/' && document.activeElement.tagName !== 'INPUT'){
    e.preventDefault();
    const inp = document.querySelector('.nav-search input');
    if(inp) inp.focus();
  }
});

// 卡片点击反馈（占位：实际可跳详情页）
document.querySelectorAll('.card').forEach(card=>{
  card.style.cursor = 'pointer';
  card.addEventListener('click',(e)=>{
    if(e.target.closest('a,button')) return;
    // 预留：跳转到文章/帖子详情
    card.style.transform = 'translateY(-4px) scale(.998)';
    setTimeout(()=>card.style.transform = '',150);
  });
});

// "加载更多" 按钮占位
const loadMore = document.querySelector('.btn-loadmore');
if(loadMore){
  loadMore.addEventListener('click',()=>{
    const orig = loadMore.textContent;
    loadMore.textContent = '加载中…';
    loadMore.style.color = 'var(--cyan)';
    setTimeout(()=>{
      loadMore.textContent = orig;
      loadMore.style.color = '';
    },1200);
  });
}

// 随机给用户头像的 cover 加一点呼吸光（细节）
document.querySelectorAll('.card-cover').forEach((cover,i)=>{
  cover.addEventListener('mousemove',(e)=>{
    const r = cover.getBoundingClientRect();
    const x = ((e.clientX - r.left)/r.width)*100;
    const y = ((e.clientY - r.top)/r.height)*100;
    cover.style.background =
      `radial-gradient(circle at ${x}% ${y}%, rgba(0,240,255,.18), transparent 50%), ${cover.dataset.bg||''}`;
  });
});

console.log('%c◈ NE<X>US // SYSTEM ONLINE','color:#00f0ff;font:bold 16px monospace;text-shadow:0 0 8px #00f0ff');
console.log('%c欢迎接入赛博社区。','color:#8a8aa8;font:12px monospace');
