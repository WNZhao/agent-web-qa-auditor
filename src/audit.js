import dns from 'node:dns/promises';
import net from 'node:net';
import * as cheerio from 'cheerio';

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function isPrivateIpv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(Number.isNaN)) return false;
  const [a, b] = octets;
  return a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    a >= 224;
}

function isPrivateIpv6(address) {
  const normalized = address.toLowerCase().split('%')[0];
  return normalized === '::' || normalized === '::1' ||
    normalized.startsWith('fc') || normalized.startsWith('fd') ||
    normalized.startsWith('fe8') || normalized.startsWith('fe9') ||
    normalized.startsWith('fea') || normalized.startsWith('feb') ||
    normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.') ||
    normalized.startsWith('::ffff:192.168.');
}

export function isPrivateAddress(address) {
  const family = net.isIP(address);
  return family === 4 ? isPrivateIpv4(address) : family === 6 ? isPrivateIpv6(address) : false;
}

export async function assertPublicUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP and HTTPS URLs are supported.');
  }
  if (url.username || url.password) throw new Error('URLs containing credentials are not supported.');
  const hostname = url.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname === 'metadata.google.internal') {
    throw new Error('Private or local hosts are not supported.');
  }
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) throw new Error('Private or local IP addresses are not supported.');
    return url;
  }
  const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('The hostname does not resolve exclusively to public IP addresses.');
  }
  return url;
}

async function readLimitedBody(response) {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) throw new Error('Response body exceeds the 2 MB limit.');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new Error('Response body exceeds the 2 MB limit.');
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

export async function safeFetch(rawUrl, { timeoutMs = 15_000, method = 'GET' } = {}) {
  let url = await assertPublicUrl(rawUrl);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(url, {
      method,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { 'user-agent': 'AgentWebQAAuditor/0.1 (+https://apify.com)' },
    });
    if (!REDIRECT_STATUSES.has(response.status)) return { response, finalUrl: url };
    const location = response.headers.get('location');
    if (!location) return { response, finalUrl: url };
    url = await assertPublicUrl(new URL(location, url).href);
  }
  throw new Error('Too many redirects.');
}

function unique(values) {
  return [...new Set(values)];
}

export function analyzeHtml(html, pageUrl) {
  const $ = cheerio.load(html);
  const title = $('title').first().text().trim();
  const description = $('meta[name="description"]').attr('content')?.trim() || '';
  const canonical = $('link[rel="canonical"]').attr('href') || '';
  const h1 = $('h1').map((_, el) => $(el).text().trim()).get().filter(Boolean);
  const images = $('img').map((_, el) => ({
    src: $(el).attr('src') || '',
    alt: $(el).attr('alt'),
  })).get();
  const forms = $('form').length;
  const viewport = $('meta[name="viewport"]').attr('content') || '';
  const links = unique($('a[href]').map((_, el) => {
    try { return new URL($(el).attr('href'), pageUrl).href; } catch { return null; }
  }).get().filter(Boolean));

  const findings = [];
  if (!title) findings.push({ severity: 'high', code: 'missing_title', message: 'Page has no title.' });
  else if (title.length > 60) findings.push({ severity: 'low', code: 'long_title', message: `Title is ${title.length} characters.` });
  if (!description) findings.push({ severity: 'medium', code: 'missing_meta_description', message: 'Page has no meta description.' });
  if (h1.length === 0) findings.push({ severity: 'medium', code: 'missing_h1', message: 'Page has no H1 heading.' });
  if (h1.length > 1) findings.push({ severity: 'low', code: 'multiple_h1', message: `Page has ${h1.length} H1 headings.` });
  const missingAlt = images.filter((image) => image.alt === undefined).length;
  if (missingAlt) findings.push({ severity: 'medium', code: 'missing_image_alt', message: `${missingAlt} image(s) have no alt attribute.` });
  if (!viewport) findings.push({ severity: 'medium', code: 'missing_viewport', message: 'Page has no viewport meta tag.' });

  return {
    metadata: { title, description, canonical, viewport },
    counts: { h1: h1.length, images: images.length, imagesMissingAlt: missingAlt, forms, links: links.length },
    headings: { h1 },
    links,
    findings,
  };
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  }));
  return results;
}

export async function auditPage({ url: rawUrl, maxLinks = 20, timeoutSecs = 15 }) {
  const startedAt = new Date().toISOString();
  const started = performance.now();
  const { response, finalUrl } = await safeFetch(rawUrl, { timeoutMs: timeoutSecs * 1000 });
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) throw new Error(`Expected HTML but received ${contentType || 'an unknown content type'}.`);
  const html = await readLimitedBody(response);
  const analysis = analyzeHtml(html, finalUrl.href);
  const sameOriginLinks = analysis.links
    .filter((link) => new URL(link).origin === finalUrl.origin)
    .slice(0, maxLinks);
  const linkChecks = await mapLimit(sameOriginLinks, 5, async (link) => {
    try {
      const { response: checked, finalUrl: checkedUrl } = await safeFetch(link, { timeoutMs: timeoutSecs * 1000, method: 'HEAD' });
      return { url: link, finalUrl: checkedUrl.href, status: checked.status, ok: checked.ok };
    } catch (error) {
      return { url: link, status: null, ok: false, error: error.message };
    }
  });
  const brokenLinks = linkChecks.filter((item) => !item.ok);
  if (brokenLinks.length) {
    analysis.findings.push({ severity: 'high', code: 'broken_internal_links', message: `${brokenLinks.length} checked same-origin link(s) failed.` });
  }
  const severityWeight = { high: 15, medium: 7, low: 2 };
  const score = Math.max(0, 100 - analysis.findings.reduce((sum, finding) => sum + severityWeight[finding.severity], 0));
  return {
    auditedAt: startedAt,
    requestedUrl: rawUrl,
    finalUrl: finalUrl.href,
    http: { status: response.status, ok: response.ok, contentType },
    durationMs: Math.round(performance.now() - started),
    score,
    ...analysis,
    linkChecks,
  };
}
