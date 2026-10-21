import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AiQuotaError, consumeAiQuota } from '../src/ai/ai-quota.mjs';

function fakeStore() {
  const saved = new Map();
  return {
    collection() {
      return { doc: (id) => id };
    },
    async runTransaction(fn) {
      const writes = [];
      await fn({
        get: async (id) => ({ data: () => saved.get(id) }),
        set: (id, value) => writes.push([id, value]),
      });
      for (const [id, value] of writes) saved.set(id, value);
    },
  };
}

test('la séptima consulta del mismo usuario no consume IA y la cuota se renueva', async () => {
  const store = fakeStore();
  const now = Date.UTC(2026, 9, 19, 12);
  for (let n = 0; n < 6; n += 1) await consumeAiQuota(store, 'guest-a', now);
  await assert.rejects(consumeAiQuota(store, 'guest-a', now), AiQuotaError);
  await consumeAiQuota(store, 'guest-b', now);
  await consumeAiQuota(store, 'guest-a', now + 60_000);
});
