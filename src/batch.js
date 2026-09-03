export function normalizeUrls(input = {}) {
  const values = [input.url, ...(Array.isArray(input.urls) ? input.urls : [])]
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim());
  const urls = [...new Set(values)];
  if (urls.length === 0) throw new Error('Provide "url" or at least one entry in "urls".');
  if (urls.length > 25) throw new Error('A maximum of 25 URLs is supported per run.');
  return urls;
}

export function summarize(results, threshold) {
  const successful = results.filter((item) => !item.error);
  const passed = results.filter((item) => item.passed);
  return {
    acceptanceThreshold: threshold,
    total: results.length,
    audited: successful.length,
    passed: passed.length,
    failed: results.length - passed.length,
    averageScore: successful.length
      ? Math.round(successful.reduce((sum, item) => sum + item.score, 0) / successful.length)
      : 0,
    accepted: results.length > 0 && passed.length === results.length,
  };
}
