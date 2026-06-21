// api/lib/ai-review.js - AI 审核适配层（多供应商）
const PROVIDERS = {
  glm:       { name: '智谱 GLM',     endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions' },
  tongyi:    { name: '通义千问',      endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions' },
  deepseek:  { name: 'DeepSeek',     endpoint: 'https://api.deepseek.com/chat/completions' },
  openai:    { name: 'OpenAI(海外)',  endpoint: 'https://api.openai.com/v1/chat/completions' },
  claude:    { name: 'Claude(海外)',  endpoint: 'https://api.anthropic.com/v1/messages' },
};

function buildReviewPrompt(text) {
  return `你是内容审核员。判断以下用户内容是否违反中国法律法规。
审核维度：
1.政治敏感 2.涉黄 3.暴恐 4.辱骂人身攻击 5.垃圾广告 6.个人信息泄露 7.违法犯罪教唆

请返回 JSON（不要其他文字）：
{"verdict":"safe|suspicious|violation|severe","score":0-100,"reason":"简短说明"}

待审核内容：
${text.substring(0, 2000)}`;
}

async function reviewContent(text, env) {
  let cfg;
  try {
    cfg = await env.DB.prepare('SELECT * FROM ai_review_config WHERE id=1').first();
  } catch(e) { /* 表不存在 */ }
  if (!cfg || !cfg.enabled) return { verdict: 'skip', score: 0, reason: 'AI审核未启用' };

  const provider = cfg.provider || 'glm';
  const model = cfg.model || 'glm-4-flash';
  const apiKey = env.AI_REVIEW_API_KEY;
  if (!apiKey && provider !== 'claude') return { verdict: 'skip', score: 0, reason: 'AI审核密钥未配置' };

  const providerCfg = PROVIDERS[provider];
  if (!providerCfg) return { verdict: 'skip', score: 0, reason: '未知供应商' };

  const start = Date.now();
  try {
    let result;
    if (provider === 'claude') {
      result = await callClaude(providerCfg, model, text, env);
    } else {
      result = await callOpenAICompat(providerCfg, model, text, apiKey);
    }
    const parsed = parseVerdict(result, cfg);
    return { ...parsed, provider, model, latency_ms: Date.now() - start };
  } catch(e) {
    return { verdict: 'error', score: 0, reason: 'AI服务异常: ' + e.message, provider, model, latency_ms: Date.now() - start };
  }
}

async function callOpenAICompat(provider, model, text, apiKey) {
  const resp = await fetch(provider.endpoint, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: buildReviewPrompt(text) }], temperature: 0.1, max_tokens: 200 }),
  });
  const json = await resp.json();
  return json.choices?.[0]?.message?.content || '';
}

async function callClaude(provider, model, text, env) {
  const apiKey = env.CLAUDE_API_KEY;
  if (!apiKey) throw new Error('Claude API key not configured');
  const resp = await fetch(provider.endpoint, {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, max_tokens: 200, messages: [{ role: 'user', content: buildReviewPrompt(text) }] }),
  });
  const json = await resp.json();
  return json.content?.[0]?.text || '';
}

function parseVerdict(text, cfg) {
  try {
    const cleaned = text.replace(/```json|```/g, '').trim();
    const obj = JSON.parse(cleaned);
    return {
      verdict: obj.verdict || 'suspicious',
      score: Math.max(0, Math.min(100, parseInt(obj.score) || 50)),
      reason: obj.reason || '未知',
    };
  } catch(e) {
    const lowered = text.toLowerCase();
    if (lowered.includes('violation') || lowered.includes('severe')) return { verdict: 'violation', score: 85, reason: 'AI判定违规' };
    if (lowered.includes('suspicious')) return { verdict: 'suspicious', score: 55, reason: 'AI判定存疑' };
    return { verdict: 'suspicious', score: 50, reason: 'AI结果解析异常' };
  }
}

export { reviewContent, PROVIDERS };
