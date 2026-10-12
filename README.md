# @unprofane/sdk

The typed client for [Unprofane](https://unprofane.com), a profanity and toxicity API that is hard to fool. No dependencies; works anywhere `fetch` does.

```bash
npm install @unprofane/sdk
```

```ts
import { Unprofane } from '@unprofane/sdk';

const unprofane = new Unprofane(process.env.UNPROFANE_API_KEY!);
const r = await unprofane.check({ text: 'xXsh1tXx', context: 'username', policy: 'teen' });
if (!r.allowed) console.log(r.action, r.evasion, r.censored);
```

`check`, `checkBatch` (up to 100), `checkMany` (any number, chunked), `feedback`, `usage`, `getList`, `putList`, `deleteList`. Retries 429 and 5xx with jitter and honours `Retry-After`; every other failure throws an `UnprofaneError` with the problem details and the request id.

Docs: https://unprofane.com/docs/. Keys are shown once in the dashboard; a publishable key (`up_pk_…`) is the one to use from a browser.
