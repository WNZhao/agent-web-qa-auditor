# Agent Web QA Auditor

Deterministic acceptance QA for up to 25 public web pages, designed for humans, CI pipelines, and AI agents that need structured evidence before accepting web work.

## Output

- HTTP status, final URL, content type, and duration
- title, meta description, canonical URL, viewport, and H1 checks
- image alt coverage and form/link counts
- up to 50 same-origin link checks
- structured findings and a deterministic 0–100 score
- configurable pass/fail threshold and a run-level acceptance decision
- batch input with one billable `page-audited` event per successful result

## Safety boundaries

- Public HTTP(S) pages only
- Rejects credentials in URLs, localhost, private/link-local IPs, and private redirects
- Caps response bodies at 2 MB, redirects at 5, and request timeouts at 30 seconds
- Does not log in, bypass access controls, submit forms, or perform security testing

## Local verification

```bash
npm install
npm test
APIFY_LOCAL_STORAGE_DIR=./storage npm start
```

Example Actor input:

```json
{
  "urls": ["https://example.com", "https://example.org"],
  "acceptanceThreshold": 85,
  "maxLinks": 10,
  "timeoutSecs": 15
}
```
