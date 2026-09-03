import { Actor } from 'apify';
import { auditPage } from './audit.js';

await Actor.init();

try {
  const input = await Actor.getInput();
  if (!input?.url) throw new Error('Input field "url" is required.');
  const result = await auditPage({
    url: input.url,
    maxLinks: Math.min(50, Math.max(0, Number(input.maxLinks ?? 20))),
    timeoutSecs: Math.min(30, Math.max(3, Number(input.timeoutSecs ?? 15))),
  });
  await Actor.pushData(result);
  await Actor.setValue('OUTPUT', result);
} finally {
  await Actor.exit();
}
