const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

export class AiQuotaError extends Error {
  constructor() { super('Alcanzaste el límite de consultas de IA. Inténtalo más tarde.'); }
}

export async function consumeAiQuota(store, ownerUid, now = Date.now()) {
  const minute = Math.floor(now / MINUTE_MS);
  const day = Math.floor(now / DAY_MS);
  const individual = store.collection('public_ai_quota').doc(`u_${ownerUid}`);
  const global = store.collection('public_ai_quota').doc('_global');
  await store.runTransaction(async (transaction) => {
    const [individualSnap, globalSnap] = await Promise.all([
      transaction.get(individual), transaction.get(global),
    ]);
    const next = (snapshot, minuteLimit, dayLimit) => {
      const data = snapshot.data() || {};
      const minuteCount = data.minute === minute ? Number(data.minuteCount || 0) : 0;
      const dayCount = data.day === day ? Number(data.dayCount || 0) : 0;
      if (minuteCount >= minuteLimit || dayCount >= dayLimit) throw new AiQuotaError();
      return { minute, minuteCount: minuteCount + 1, day, dayCount: dayCount + 1 };
    };
    const individualNext = next(individualSnap, 6, 60);
    const globalNext = next(globalSnap, 30, 500);
    transaction.set(individual, individualNext);
    transaction.set(global, globalNext);
  });
}
