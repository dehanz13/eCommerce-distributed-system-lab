import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { cfg, pool } from '@lab/runtime';
import { request } from '@lab/client';
import type { Cart, Order, Preview, Product } from '@lab/contracts';
const api = <T>(path: string, method = 'GET', body?: unknown, headers?: Record<string, string>) =>
  request<T>(
    '/api/v1' + path,
    { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }), headers },
    cfg.ORDERING_URL,
  ).then((reply) => reply.data);
async function until<T>(
  read: () => Promise<T>,
  ready: (value: T) => boolean,
  label: string,
  timeout = 25000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (ready(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Recovery deadline: ' + label);
}
async function action(name: string, service?: string) {
  const response = await fetch(cfg.OPERATOR_URL + '/api/v1/actions', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, service }),
  });
  assert.equal(response.status, 202);
  const { data } = await response.json();
  const result = await until(
    () =>
      fetch(cfg.OPERATOR_URL + '/api/v1/actions/' + data.id)
        .then((r) => r.json())
        .then((r) => r.data),
    (value) => ['completed', 'failed'].includes(value.status),
    name + ' ' + service,
    90000,
  );
  assert.equal(result.status, 'completed', result.error ?? 'operator action must complete');
  return result;
}
async function settings(preset: string, paused = false) {
  const response = await fetch(cfg.FULFILLMENT_URL + '/api/v1/settings', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ preset, paused }),
  });
  assert.equal(response.status, 200);
}
const ordering = pool('ordering');
const fulfillment = pool('fulfillment');
const product = await api<Product>('/products', 'POST', {
  name: 'Recovery specimen ' + randomUUID().slice(0, 8),
  description: 'Fictional fault-recovery record',
  priceCents: 300,
  availableStock: 5,
});
async function prepare() {
  const cart = await api<Cart>('/carts', 'POST', { shopperId: randomUUID() });
  await api(`/carts/${cart.id}/items/${product.id}`, 'PUT', { quantity: 1 });
  const preview = await api<Preview>(`/carts/${cart.id}/preview`);
  return {
    cart,
    submission: {
      cartId: cart.id,
      revision: preview.revision,
      priceFingerprint: preview.priceFingerprint,
    },
    key: randomUUID(),
  };
}
try {
  await settings('slow');
  const pending = await prepare();
  // Discard the accepted response, modeling a caller that has no usable result after commit.
  await api<Order>('/checkouts', 'POST', pending.submission, { 'idempotency-key': pending.key });
  const replay = await api<Order>('/checkouts', 'POST', pending.submission, {
    'idempotency-key': pending.key,
  });
  assert.equal(
    (
      await ordering.query('SELECT count(*)::integer AS n FROM orders WHERE shopper_id=$1', [
        pending.cart.shopperId,
      ])
    ).rows[0].n,
    1,
  );
  await until(
    () =>
      fulfillment.query('SELECT * FROM jobs WHERE order_id=$1', [replay.id]).then((r) => r.rows[0]),
    (value) => value?.status === 'processing',
    'active attempt',
  );
  const attemptBefore = (
    await fulfillment.query(
      'SELECT a.* FROM attempts a JOIN jobs j ON j.id=a.job_id WHERE j.order_id=$1',
      [replay.id],
    )
  ).rows[0];
  await action('restart', 'fulfillment');
  await until(
    () => api<Order>('/orders/' + replay.id),
    (value) => value.status === 'fulfilled',
    'resumed job',
  );
  const attemptsAfter = (
    await fulfillment.query(
      'SELECT a.* FROM attempts a JOIN jobs j ON j.id=a.job_id WHERE j.order_id=$1',
      [replay.id],
    )
  ).rows;
  assert.equal(
    attemptsAfter.length,
    1,
    'restart resumes the recorded attempt, without spending a second attempt',
  );
  assert.equal(attemptsAfter[0].id, attemptBefore.id);
  const acceptedEvent = (
    await ordering.query("SELECT payload FROM outbox WHERE payload->'data'->>'orderId'=$1", [
      replay.id,
    ])
  ).rows[0].payload;
  const amqp = await import('amqplib');
  const connection = await amqp.connect(
    `amqp://${encodeURIComponent(cfg.RABBIT_USER)}:${encodeURIComponent(cfg.RABBIT_PASSWORD)}@${cfg.RABBIT_HOST}:${cfg.RABBIT_PORT}`,
  );
  const channel = await connection.createConfirmChannel();
  for (const event of [acceptedEvent, { ...acceptedEvent, id: randomUUID() }])
    await new Promise<void>((resolve, reject) =>
      channel.sendToQueue(
        'lab.accepted',
        Buffer.from(JSON.stringify(event)),
        { persistent: true },
        (error) => (error ? reject(error) : resolve()),
      ),
    );
  await channel.close();
  await connection.close();
  await new Promise((resolve) => setTimeout(resolve, 750));
  assert.equal(
    (
      await fulfillment.query('SELECT count(*)::integer AS n FROM jobs WHERE order_id=$1', [
        replay.id,
      ])
    ).rows[0].n,
    1,
    'redelivery after lost acknowledgment cannot create another job',
  );
  await settings('success');
  await action('stop', 'rabbitmq');
  const outage = await prepare();
  const accepted = await api<Order>('/checkouts', 'POST', outage.submission, {
    'idempotency-key': outage.key,
  });
  assert.equal(accepted.status, 'accepted');
  assert.equal(
    (
      await ordering.query(
        "SELECT count(*)::integer AS n FROM outbox WHERE published_at IS NULL AND payload->'data'->>'orderId'=$1",
        [accepted.id],
      )
    ).rows[0].n,
    1,
    'outbox preserves committed work during broker outage',
  );
  assert.equal(
    (
      await fulfillment.query('SELECT count(*)::integer AS n FROM jobs WHERE order_id=$1', [
        accepted.id,
      ])
    ).rows[0].n,
    0,
    'connectivity failure does not allocate processing attempts',
  );
  await action('start', 'rabbitmq');
  await until(
    () => api<Order>('/orders/' + accepted.id),
    (value) => value.status === 'fulfilled',
    'broker recovery',
  );
  assert.equal(
    (await fulfillment.query('SELECT attempt_number FROM jobs WHERE order_id=$1', [accepted.id]))
      .rows[0].attempt_number,
    1,
  );
  await action('stop', 'postgres');
  const unavailable = await fetch(cfg.ORDERING_URL + '/api/v1/products');
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).code, 'DEPENDENCY_UNAVAILABLE');
  await action('start', 'postgres');
  await until(
    () => fetch(cfg.ORDERING_URL + '/health').then((r) => r.json()),
    (value) => value.data?.ready,
    'database recovery',
  );
  assert.equal(
    (await api<Order>('/orders/' + accepted.id)).status,
    'fulfilled',
    'durable work survives database interruption',
  );
  await settings('success');
  console.log(
    'PASS: discarded response replay, recorded-attempt restart, duplicate accepted delivery, broker-outage outbox recovery, database outage and recovery',
  );
} finally {
  await ordering.end();
  await fulfillment.end();
}
