// api/links.js - external link preview metadata
import { Hono } from 'hono';
import { ok, err, CODE } from './lib/response.js';

const linksRouter = new Hono();
const PREVIEW_TTL = 7 * 24 * 60 * 60 * 1000;
const FAILED_TTL = 6 * 60 * 60 * 1000;
const MAX_URLS = 6;

function cleanUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.length > 2048) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (error) {
    return null;
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) return null;
  parsed.hash = '';
  if (isBlockedHost(parsed.hostname)) return null;
  return parsed.toString();
}

function isBlockedHost(hostname) {
  const host = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '0.0.0.0' || host === '::' || host === '::1') return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const parts = host.split('.').map(part => Number(part));
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true;
  }
  if (/^(fc|fd|fe80|::ffff:127\.|::ffff:10\.|::ffff:192\.168\.)/i.test(host)) return true;
  return false;
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code) || 0))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16) || 0))
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMeta(html, names) {
  for (const name of names) {
    const propRe = new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]+content=["']([^"']+)["'][^>]*>`, 'i');
    const contentFirstRe = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${name}["'][^>]*>`, 'i');
    const match = html.match(propRe) || html.match(contentFirstRe);
    if (match) return decodeHtml(match[1]);
  }
  return '';
}

function firstLinkHref(html, relPattern) {
  const re = /<link[^>]+>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const tag = match[0];
    const rel = tag.match(/\srel=["']([^"']+)["']/i)?.[1] || '';
    if (!relPattern.test(rel)) continue;
    const href = tag.match(/\shref=["']([^"']+)["']/i)?.[1] || '';
    if (href) return decodeHtml(href);
  }
  return '';
}

function absoluteAssetUrl(value, base) {
  if (!value) return '';
  try {
    const url = new URL(value, base);
    if (!['http:', 'https:'].includes(url.protocol) || isBlockedHost(url.hostname)) return '';
    return url.toString();
  } catch (error) {
    return '';
  }
}

function extractPreview(html, sourceUrl, finalUrl) {
  const head = String(html || '').slice(0, 220_000);
  const title = firstMeta(head, ['og:title', 'twitter:title'])
    || decodeHtml(head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const description = firstMeta(head, ['og:description', 'twitter:description', 'description']);
  const siteName = firstMeta(head, ['og:site_name']) || '';
  const image = absoluteAssetUrl(firstMeta(head, ['og:image', 'twitter:image']), finalUrl || sourceUrl);
  const favicon = absoluteAssetUrl(firstLinkHref(head, /(^|\s)(shortcut\s+icon|icon|apple-touch-icon)(\s|$)/i), finalUrl || sourceUrl)
    || absoluteAssetUrl('/favicon.ico', finalUrl || sourceUrl);
  const host = new URL(finalUrl || sourceUrl).hostname.replace(/^www\./i, '');
  return {
    url: sourceUrl,
    final_url: finalUrl || sourceUrl,
    title: (title || host).slice(0, 180),
    description: description.slice(0, 260),
    site_name: (siteName || host).slice(0, 80),
    image,
    favicon,
    host,
    status: 'ok',
  };
}

async function cachedPreview(env, url) {
  const row = await env.DB.prepare('SELECT * FROM link_previews WHERE url=?').bind(url).first().catch(() => null);
  if (!row) return null;
  const ttl = row.status === 'ok' ? PREVIEW_TTL : FAILED_TTL;
  if (Date.now() - Number(row.fetched_at || 0) > ttl) return null;
  return {
    url: row.url,
    final_url: row.final_url || row.url,
    title: row.title || '',
    description: row.description || '',
    site_name: row.site_name || '',
    image: row.image || '',
    favicon: row.favicon || '',
    host: row.host || '',
    status: row.status || 'ok',
  };
}

async function savePreview(env, preview) {
  await env.DB.prepare(
    `INSERT INTO link_previews(url,final_url,title,description,site_name,image,favicon,host,status,fetched_at)
     VALUES(?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(url) DO UPDATE SET
       final_url=excluded.final_url,
       title=excluded.title,
       description=excluded.description,
       site_name=excluded.site_name,
       image=excluded.image,
       favicon=excluded.favicon,
       host=excluded.host,
       status=excluded.status,
       fetched_at=excluded.fetched_at`
  ).bind(
    preview.url,
    preview.final_url || preview.url,
    preview.title || '',
    preview.description || '',
    preview.site_name || '',
    preview.image || '',
    preview.favicon || '',
    preview.host || '',
    preview.status || 'ok',
    Date.now()
  ).run();
}

async function buildPreview(env, rawUrl) {
  const url = cleanUrl(rawUrl);
  if (!url) return null;
  const cached = await cachedPreview(env, url);
  if (cached) return cached;

  let preview;
  try {
    const response = await fetch(url, {
      headers: {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.5',
        'user-agent': 'NodeWeave-LinkPreview/1.0',
      },
      signal: AbortSignal.timeout(5500),
    });
    const finalUrl = cleanUrl(response.url || url);
    if (!finalUrl) throw new Error('blocked_final_url');
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok || !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
      const parsed = new URL(finalUrl);
      preview = {
        url,
        final_url: finalUrl,
        title: parsed.hostname.replace(/^www\./i, ''),
        description: '',
        site_name: parsed.hostname.replace(/^www\./i, ''),
        image: '',
        favicon: absoluteAssetUrl('/favicon.ico', finalUrl),
        host: parsed.hostname.replace(/^www\./i, ''),
        status: response.ok ? 'ok' : 'failed',
      };
    } else {
      const html = await response.text();
      preview = extractPreview(html, url, finalUrl);
    }
  } catch (error) {
    const parsed = new URL(url);
    preview = {
      url,
      final_url: url,
      title: parsed.hostname.replace(/^www\./i, ''),
      description: '',
      site_name: parsed.hostname.replace(/^www\./i, ''),
      image: '',
      favicon: absoluteAssetUrl('/favicon.ico', url),
      host: parsed.hostname.replace(/^www\./i, ''),
      status: 'failed',
    };
  }
  await savePreview(env, preview).catch(() => null);
  return preview;
}

linksRouter.get('/preview', async (c) => {
  const preview = await buildPreview(c.env, c.req.query('url'));
  if (!preview) return err(c, CODE.VALIDATION, '链接无效或不允许预览');
  return ok(c, preview);
});

linksRouter.post('/preview-batch', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const urls = [...new Set((Array.isArray(body.urls) ? body.urls : []).map(cleanUrl).filter(Boolean))].slice(0, MAX_URLS);
  const previews = [];
  for (const url of urls) {
    const preview = await buildPreview(c.env, url);
    if (preview) previews.push(preview);
  }
  return ok(c, { previews });
});

export { linksRouter };
