import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { backoff, MAX_BATCH_CHARS, SDK_VERSION, Unprofane, UnprofaneError } from './index.ts';

const ok = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

describe('the JavaScript SDK', () => {
  it('reports the version package.json publishes', () => {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
    expect(SDK_VERSION).toBe(pkg.version);
  });

  it('sends the bearer key and the body, and parses the answer', async () => {
    const fetchMock = vi.fn(async () => ok({ allowed: false, action: 'block' }));
    const c = new Unprofane('up_test_abc', { fetch: fetchMock as unknown as typeof fetch });
    const r = await c.check({ text: 'xXsh1tXx', context: 'username' });
    expect(r.action).toBe('block');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.unprofane.com/v1/check');
    const h = init.headers as Record<string, string>;
    expect(h.authorization).toBe('Bearer up_test_abc');
    expect(JSON.parse(String(init.body))).toEqual({ text: 'xXsh1tXx', context: 'username' });
  });

  it('calls the platform fetch as browsers and Workers require, never as a method of the client', async () => {
    // A browser or workerd throws "Illegal invocation" when fetch runs with
    // an object as `this`.
    const strict = vi.fn(function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve(ok({ allowed: true, action: 'allow' }));
    });
    vi.stubGlobal('fetch', strict);
    try {
      const c = new Unprofane('up_test_abc', { retries: 0 });
      await expect(c.check({ text: 'hello' })).resolves.toMatchObject({ action: 'allow' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('refuses a key that is not one of ours', () => {
    expect(() => new Unprofane('sk-nope')).toThrow(TypeError);
  });

  it('retries a 429 with Retry-After, then a 503, and throws a problem on a 400', async () => {
    let n = 0;
    const fetchMock = vi.fn(async () => {
      n++;
      if (n === 1)
        return ok({ type: 'x', title: 'Too many requests.', status: 429 }, 429, {
          'retry-after': '0',
        });
      if (n === 2) return new Response('down', { status: 503 });
      return ok({ id: 'chk_1', allowed: true });
    });
    const c = new Unprofane('up_live_k', {
      fetch: fetchMock as unknown as typeof fetch,
      retries: 3,
    });
    const r = await c.check({ text: 'hi' });
    expect(r.allowed).toBe(true);
    expect(n).toBe(3);

    const bad = vi.fn(async () =>
      ok(
        {
          type: 'https://unprofane.com/docs/errors/invalid-request',
          title: 'The request body is not valid.',
          status: 400,
          detail: 'text: too long',
        },
        400,
        { 'request-id': 'req_9' },
      ),
    );
    const c2 = new Unprofane('up_live_k', { fetch: bad as unknown as typeof fetch });
    const err = await c2.check({ text: '' }).catch((e) => e);
    expect(err).toBeInstanceOf(UnprofaneError);
    expect(err.status).toBe(400);
    expect(err.problem.type).toContain('invalid-request');
    expect(err.requestId).toBe('req_9');
    expect(bad).toHaveBeenCalledTimes(1);
  });

  it('chunks checkMany into batches of 100 and keeps the order', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { items: Array<{ id: string; text: string }> };
      return ok({
        results: body.items.map((i) => ({ id: i.id, result: { allowed: i.text !== 'bad' } })),
        counted: body.items.length,
      });
    });
    const c = new Unprofane('up_live_k', { fetch: fetchMock as unknown as typeof fetch });
    const texts = Array.from({ length: 250 }, (_, i) => (i === 137 ? 'bad' : `t${i}`));
    const results = await c.checkMany(texts, { context: 'comment', concurrency: 3 });
    expect(results).toHaveLength(250);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(results[137]).toMatchObject({ id: '137', result: { allowed: false } });
    expect(results[249]?.id).toBe('249');
    expect(() =>
      c.checkBatch({
        items: Array.from({ length: 101 }, (_, i) => ({ id: String(i), text: 'x' })),
      }),
    ).toThrow(RangeError);
  });

  it('chunks checkMany at 30,000 characters too, the most the API reads in one batch', async () => {
    // The API refuses a batch whose texts hold more than 30,000 characters
    // together (2026-10-19): 100 long texts in one request were refused whole.
    // The monorepo holds the number to the API's (contracts schemas.test.ts).
    expect(MAX_BATCH_CHARS).toBe(30_000);
    const sizes: number[][] = [];
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { items: Array<{ id: string; text: string }> };
      sizes.push(body.items.map((i) => i.text.length));
      return ok({
        results: body.items.map((i) => ({ id: i.id, result: { allowed: true } })),
        counted: body.items.length,
      });
    });
    const c = new Unprofane('up_live_k', { fetch: fetchMock as unknown as typeof fetch });
    const long = Array.from({ length: 4 }, (_, i) => `${i}`.repeat(10_000));
    const results = await c.checkMany(long, { concurrency: 1 });
    expect(sizes.map((s) => s.length)).toEqual([3, 1]);
    expect(results.map((r) => r.id)).toEqual(['0', '1', '2', '3']);
    sizes.length = 0;
    await c.checkMany(
      Array.from({ length: 100 }, () => 'x'.repeat(400)),
      { concurrency: 1 },
    );
    expect(sizes.map((s) => s.length)).toEqual([75, 25]);
    for (const s of sizes)
      expect(s.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(MAX_BATCH_CHARS);
    expect(() => c.checkBatch({ items: long.map((text, i) => ({ id: String(i), text })) })).toThrow(
      RangeError,
    );
  });

  it('backs off with jitter under the cap and honours Retry-After', () => {
    expect(backoff(1, '2')).toBe(2000);
    for (let i = 0; i < 20; i++) expect(backoff(5, null)).toBeLessThanOrEqual(8000);
    expect(backoff(1, 'soon')).toBeLessThanOrEqual(500);
  });

  it('reads and empties a list', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) =>
      init.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : ok({ kind: 'allow', terms: ['Scunthorpe'], version: 2 }),
    );
    const c = new Unprofane('up_live_k', { fetch: fetchMock as unknown as typeof fetch });
    expect((await c.getList('prj_1', 'allow')).terms).toEqual(['Scunthorpe']);
    await expect(c.deleteList('prj_1', 'allow')).resolves.toBeUndefined();
  });
});
