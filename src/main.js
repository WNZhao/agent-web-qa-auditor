import { Actor } from 'apify';
import { auditPage } from './audit.js';
import { normalizeUrls, summarize } from './batch.js';

await Actor.init();

try {
  const input = await Actor.getInput() ?? {};
  const urls = normalizeUrls(input);
  const acceptanceThreshold = Math.min(100, Math.max(0, Number(input.acceptanceThreshold ?? 85)));
  const options = {
    maxLinks: Math.min(50, Math.max(0, Number(input.maxLinks ?? 20))),
    timeoutSecs: Math.min(30, Math.max(3, Number(input.timeoutSecs ?? 15))),
  };
  const results = [];

  for (const url of urls) {
    try {
      const audit = await auditPage({ url, ...options });
      const result = {
        ...audit,
        acceptanceThreshold,
        passed: audit.http.ok && audit.score >= acceptanceThreshold,
      };
      const charge = await Actor.pushData(result, 'page-audited');
      if (charge.eventChargeLimitReached && charge.chargedCount === 0) break;
      results.push(result);
    } catch (error) {
      results.push({
        requestedUrl: url,
        acceptanceThreshold,
        passed: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await Actor.setValue('OUTPUT', {
    summary: summarize(results, acceptanceThreshold),
    results,
  });
} finally {
  await Actor.exit();
}
