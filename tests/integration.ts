import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cfg, pool } from '@lab/runtime';
import { request, ApiError } from '@lab/client';
import type { Product, Cart, Preview, Order } from '@lab/contracts';
const api = <T>(path: string, method = 'GET', body?: unknown, headers?: Record<string, string>) =>
  request<T>(
    '/api/v1' + path,
    { method, ...(body ? { body: JSON.stringify(body) } : {}), headers },
    cfg.ORDERING_URL,
  ).then((r) => r.data);
const setting = async (preset: string) => {
  const r = await fetch(cfg.FULFILLMENT_URL + '/api/v1/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ preset, paused: false }),
  });
  assert.equal(r.status, 200);
};
const product = await api<Product>('/products', 'POST', {
  name: 'Integration specimen ' + randomUUID().slice(0, 8),
  description: 'Fictional verification record',
  priceCents: 125,
  availableStock: 1,
});
async function cart() {
  const c = await api<Cart>('/carts', 'POST', { shopperId: randomUUID() });
  await api(`/carts/${c.id}/items/${product.id}`, 'PUT', { quantity: 1 });
  return c;
}
async function submission(c: Cart) {
  const v = await api<Preview>(`/carts/${c.id}/preview`);
  return { cartId: c.id, revision: v.revision, priceFingerprint: v.priceFingerprint };
}
const a = await cart(),
  b = await cart();
const pa = await submission(a),
  pb = await submission(b);
const keys = [randomUUID(), randomUUID()];
const key = keys[0]!;
await setting('slow');
const results = await Promise.allSettled([
  api<Order>('/checkouts', 'POST', pa, { 'idempotency-key': key }),
  api<Order>('/checkouts', 'POST', pb, { 'idempotency-key': keys[1]! }),
]);
assert.equal(
  results.filter((r) => r.status === 'fulfilled').length,
  1,
  'exactly one competing checkout accepts last stock',
);
const winner = results.find((r) => r.status === 'fulfilled');
assert(winner?.status === 'fulfilled');
const winnerIndex = results.indexOf(winner);
const winnerBody = winnerIndex === 0 ? pa : pb;
const replayKey = keys[winnerIndex]!;
if (replayKey) {
  const replay = await api<Order>('/checkouts', 'POST', winnerBody, {
    'idempotency-key': replayKey,
  });
  assert.equal(replay.id, winner.value.id);
  await assert.rejects(
    api(
      '/checkouts',
      'POST',
      { ...winnerBody, revision: winnerBody.revision + 1 },
      { 'idempotency-key': replayKey },
    ),
    (e: unknown) => e instanceof ApiError && e.code === 'IDEMPOTENCY_CONFLICT',
  );
}
const loser = winnerIndex === 0 ? b : a;
assert.equal(
  (await api<Cart>(`/carts/${loser.id}`)).items.length,
  1,
  'failed acceptance preserves cart',
);
await api(`/products/${product.id}/stock`, 'POST', { delta: 5 });
const c = await cart();
const pc = await submission(c);
await api(`/products/${product.id}`, 'PATCH', { priceCents: 150 });
await assert.rejects(
  api('/checkouts', 'POST', pc, { 'idempotency-key': randomUUID() }),
  (e: unknown) => e instanceof ApiError && e.code === 'PRICE_CHANGED',
);
await api(`/carts/${c.id}/items/${product.id}`, 'PUT', { quantity: 2 });
await api(`/carts/${c.id}/items/${product.id}`, 'PUT', { quantity: 1 });
assert.equal((await api<Cart>(`/carts/${c.id}`)).items[0]?.quantity, 1);
await assert.rejects(
  api('/checkouts', 'POST', pc, { 'idempotency-key': randomUUID() }),
  (e: unknown) => e instanceof ApiError && e.code === 'CART_CHANGED',
);
await setting('fail');
const pd = await submission(c);
const failed = await api<Order>('/checkouts', 'POST', pd, { 'idempotency-key': randomUUID() });
let observed = failed;
for (let i = 0; i < 100 && observed.status === 'accepted'; i++) {
  await new Promise((r) => setTimeout(r, 250));
  observed = await api<Order>('/orders/' + failed.id);
}
assert.equal(observed.status, 'failed');
const before = (await api<Product[]>('/products')).find((x) => x.id === product.id)!.availableStock;
const p = pool('fulfillment');
const event = (
  await p.query("SELECT payload FROM outbox WHERE payload->'data'->>'orderId'=$1", [failed.id])
).rows[0].payload;
const amqp = await import('amqplib');
const conn = await amqp.connect(
  `amqp://${cfg.RABBIT_USER}:${cfg.RABBIT_PASSWORD}@${cfg.RABBIT_HOST}:${cfg.RABBIT_PORT}`,
);
const channel = await conn.createConfirmChannel();
for (const e of [event, { ...event, id: randomUUID() }])
  await new Promise<void>((resolve, reject) =>
    channel.sendToQueue(
      'lab.outcomes',
      Buffer.from(JSON.stringify(e)),
      { persistent: true },
      (error) => (error ? reject(error) : resolve()),
    ),
  );
await new Promise((r) => setTimeout(r, 1000));
assert.equal(
  (await api<Product[]>('/products')).find((x) => x.id === product.id)!.availableStock,
  before,
  'duplicate failures release stock once',
);
await channel.close();
await conn.close();
await p.end();
const recovery = await api<Cart>('/orders/' + failed.id + '/recover', 'POST');
assert.equal(recovery.items.length, 1);
await setting('success');
console.log(
  'PASS: overselling, preservation, idempotency, price/cart conflicts, LWW, async failure, compensation deduplication and recovery',
);
