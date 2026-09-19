const TRANSIENT_STATUSES = new Set([429, 503, 529]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POSTs JSON and returns the parsed body. Transient statuses are retried with backoff.
 * Model requests are idempotent; browser mutations are never retried through here.
 */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: { retries?: number; label?: string } = {}
): Promise<any> {
  const retries = options.retries ?? 2;
  const label = options.label || 'Model provider';

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
      });
    } catch (err: any) {
      throw new Error(`${label} connection failed (${err?.message || String(err)}); no action executed.`);
    }

    if (TRANSIENT_STATUSES.has(response.status) && attempt < retries) {
      await sleep(500 * 2 ** attempt);
      continue;
    }

    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.text()).slice(0, 300);
      } catch {
        // ignore unreadable body
      }
      throw new Error(`${label} error (HTTP ${response.status})${detail ? `: ${detail}` : ''}`);
    }

    return response.json();
  }
}
