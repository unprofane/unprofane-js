/**
 * @unprofane/sdk: the typed client for https://api.unprofane.com.
 *
 *   import { Unprofane } from '@unprofane/sdk';
 *   const unprofane = new Unprofane(process.env.UNPROFANE_API_KEY!);
 *   const r = await unprofane.check({ text: 'xXsh1tXx', context: 'username', policy: 'teen' });
 *   if (!r.allowed) console.log(r.action, r.evasion, r.censored);
 *
 * No dependencies: `fetch` from the runtime (Node 18+, Bun, Deno, Workers,
 * browsers with a publishable key). Retries with jitter on 429, 502, 503,
 * 504 and network failures, honouring Retry-After; a 4xx other than 429
 * is thrown once as an UnprofaneError carrying the problem details.
 */
import type {
  BatchItem,
  BatchRequest,
  BatchResponse,
  BatchResult,
  CheckRequest,
  CheckResponse,
  FeedbackRequest,
  FeedbackResponse,
  List,
  ListKind,
  Problem,
  UsageResponse,
} from './types.ts';

export * from './types.ts';

export interface UnprofaneOptions {
  /** Defaults to https://api.unprofane.com. */
  baseUrl?: string;
  /** Retries after the first attempt; default 3. */
  retries?: number;
  /** Per-attempt timeout in milliseconds; default 10,000. */
  timeoutMs?: number;
  /** A fetch to use instead of the runtime's (tests, custom agents). */
  fetch?: typeof fetch;
}

export class UnprofaneError extends Error {
  readonly status: number;
  readonly problem: Problem | null;
  readonly requestId: string | null;
  constructor(message: string, status: number, problem: Problem | null, requestId: string | null) {
    super(message);
    this.name = 'UnprofaneError';
    this.status = status;
    this.problem = problem;
    this.requestId = requestId;
  }
}

const RETRYABLE = new Set([429, 502, 503, 504]);
const MAX_BATCH = 100;
export const SDK_VERSION = '0.1.3';

export class Unprofane {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly retries: number;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(apiKey: string, options: UnprofaneOptions = {}) {
    if (!apiKey || !/^up_(live|test|pk)_/.test(apiKey))
      throw new TypeError('Unprofane: pass an API key (up_live_…, up_test_… or up_pk_…)');
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://api.unprofane.com').replace(/\/+$/, '');
    this.retries = options.retries ?? 3;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
  }

  /** One text: should it be allowed, with the evidence. */
  check(request: CheckRequest): Promise<CheckResponse> {
    return this.call<CheckResponse>('POST', '/v1/check', request);
  }

  /** Up to 100 items with ids, answered in order. */
  checkBatch(request: BatchRequest): Promise<BatchResponse> {
    if (request.items.length > MAX_BATCH)
      throw new RangeError(`checkBatch takes at most ${MAX_BATCH} items; use checkMany`);
    return this.call<BatchResponse>('POST', '/v1/check/batch', request);
  }

  /**
   * Any number of texts: chunked into batches of 100, `concurrency`
   * batches in flight (default 2), results in input order. A chunk that
   * fails after its retries throws; the chunks already answered are lost
   * with it, so keep a chunk's worth of texts per call where that matters.
   */
  async checkMany(
    texts: string[],
    options: Omit<BatchRequest, 'items'> & { concurrency?: number } = {},
  ): Promise<BatchResult[]> {
    const { concurrency = 2, ...rest } = options;
    const chunks: BatchItem[][] = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH)
      chunks.push(texts.slice(i, i + MAX_BATCH).map((text, j) => ({ id: String(i + j), text })));
    const out: BatchResult[][] = new Array(chunks.length);
    let next = 0;
    const worker = async () => {
      for (;;) {
        const i = next++;
        if (i >= chunks.length) return;
        out[i] = (await this.checkBatch({ ...rest, items: chunks[i] as BatchItem[] })).results;
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, worker));
    return out.flat();
  }

  /** Report a wrong result. `text` is stored with your account only if you include it. */
  feedback(request: FeedbackRequest): Promise<FeedbackResponse> {
    return this.call<FeedbackResponse>('POST', '/v1/feedback', request);
  }

  /** This period's usage for the key's account. */
  usage(): Promise<UsageResponse> {
    return this.call<UsageResponse>('GET', '/v1/usage');
  }

  /** The key's project lists: read, replace, empty. */
  getList(projectId: string, kind: ListKind): Promise<List> {
    return this.call<List>('GET', `/v1/projects/${encodeURIComponent(projectId)}/lists/${kind}`);
  }
  putList(projectId: string, kind: ListKind, terms: string[]): Promise<List> {
    return this.call<List>('PUT', `/v1/projects/${encodeURIComponent(projectId)}/lists/${kind}`, {
      terms,
    });
  }
  async deleteList(projectId: string, kind: ListKind): Promise<void> {
    await this.call<null>('DELETE', `/v1/projects/${encodeURIComponent(projectId)}/lists/${kind}`);
  }

  private async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    let attempt = 0;
    for (;;) {
      let res: Response;
      try {
        res = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method,
          headers: {
            authorization: `Bearer ${this.apiKey}`,
            'user-agent': `unprofane-sdk-js/${SDK_VERSION}`,
            ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        if (attempt++ >= this.retries) throw error;
        await sleep(backoff(attempt, null));
        continue;
      }
      if (res.ok) return res.status === 204 ? (null as T) : ((await res.json()) as T);
      const requestId = res.headers.get('request-id');
      const problem = await readProblem(res);
      if (RETRYABLE.has(res.status) && attempt++ < this.retries) {
        await sleep(backoff(attempt, res.headers.get('retry-after')));
        continue;
      }
      throw new UnprofaneError(
        problem?.detail ?? problem?.title ?? `Unprofane ${method} ${path} failed (${res.status})`,
        res.status,
        problem,
        requestId,
      );
    }
  }
}

async function readProblem(res: Response): Promise<Problem | null> {
  try {
    const json = (await res.json()) as Partial<Problem>;
    if (json && typeof json.title === 'string')
      return { ...json, status: json.status ?? res.status } as Problem;
  } catch {}
  return null;
}

/** Exponential with full jitter, capped at eight seconds; Retry-After wins when present. */
export function backoff(attempt: number, retryAfter: string | null): number {
  const header = retryAfter ? Number(retryAfter) : Number.NaN;
  if (Number.isFinite(header) && header >= 0) return Math.min(header * 1000, 30_000);
  const cap = Math.min(8000, 250 * 2 ** attempt);
  return Math.random() * cap;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
