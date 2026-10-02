import './runtime-fixture';
import { randomUUID } from 'node:crypto';
import { afterAll, expect, it } from 'vitest';
import {
  ProductWrite,
  CheckoutWrite,
  validateReply,
  FeederInput,
  ExperimentInput,
} from '@lab/contracts';
import { server, response, Problem } from '@lab/runtime';
const app = await server('contract-test');
const product = {
  id: randomUUID(),
  name: 'Fixture',
  description: 'Fictional',
  priceCents: 125,
  availableStock: 1,
  active: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  deactivatedAt: null,
};
app.get('/api/v1/products', (request) => response(request, [product]));
app.post('/api/v1/products', { schema: { body: ProductWrite } }, (request) =>
  response(request, product),
);
app.post('/api/v1/checkouts', { schema: { body: CheckoutWrite } }, () => {
  throw new Problem(409, 'CART_CHANGED', 'Confirm the changed cart again');
});
app.post('/api/v1/feeder', { schema: { body: FeederInput } }, (req) => response(req, null));
app.post('/api/v1/experiments', { schema: { body: ExperimentInput } }, () => {
  throw new Problem(409, 'EXERCISE_FIXTURE', 'Fixture only');
});
afterAll(() => app.close());
it('serializes a product response matching the shared runtime contract', async () => {
  const correlationId = randomUUID();
  const result = await app.inject({
    method: 'GET',
    url: '/api/v1/products',
    headers: { 'x-correlation-id': correlationId },
  });
  expect(result.statusCode).toBe(200);
  expect(() => validateReply('/api/v1/products', 'GET', result.json())).not.toThrow();
  expect(result.json().meta.correlationId).toBe(correlationId);
});
it('rejects invalid and extra write fields without silently changing the submission', async () => {
  const result = await app.inject({
    method: 'POST',
    url: '/api/v1/products',
    payload: {
      name: 'Fixture',
      description: '',
      priceCents: 1,
      availableStock: -1,
      authorityTimestamp: 'invented',
    },
  });
  expect(result.statusCode).toBe(400);
  expect(result.json()).toMatchObject({ code: 'VALIDATION_FAILED', status: 400 });
  expect(result.json().details.length).toBeGreaterThan(0);
});
it('reports malformed JSON as a client error rather than a dependency outage', async () => {
  const result = await app.inject({
    method: 'POST',
    url: '/api/v1/products',
    headers: { 'content-type': 'application/json' },
    payload: '{',
  });
  expect(result.statusCode).toBe(400);
  expect(result.json().code).toBe('INVALID_REQUEST');
});
it('preserves stable business error codes and request identifiers', async () => {
  const result = await app.inject({
    method: 'POST',
    url: '/api/v1/checkouts',
    payload: { cartId: randomUUID(), revision: 1, priceFingerprint: 'a'.repeat(64) },
  });
  expect(result.statusCode).toBe(409);
  expect(result.headers['content-type']).toContain('application/problem+json');
  expect(result.json()).toMatchObject({
    code: 'CART_CHANGED',
    requestId: expect.any(String),
    correlationId: expect.any(String),
    respondedAt: expect.any(String),
  });
});
it('exports observed request/response activity with correlation and timing metadata', async () => {
  const correlationId = randomUUID();
  await app.inject({
    method: 'GET',
    url: '/api/v1/products',
    headers: { 'x-correlation-id': correlationId },
  });
  const result = await app.inject('/activity?correlationId=' + correlationId);
  expect(() => validateReply('/activity', 'GET', result.json())).not.toThrow();
  expect(result.json().data).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'http.received', correlationId, route: '/api/v1/products' }),
      expect.objectContaining({
        type: 'http.completed',
        correlationId,
        status: 200,
        durationMs: expect.any(Number),
      }),
    ]),
  );
});

it('rejects excessive shopper traffic and unknown fault scenarios at the contract seam', async () => {
  const shoppers = await app.inject({
    method: 'POST',
    url: '/api/v1/feeder',
    payload: { shoppers: 501, concurrency: 21, seed: 42, thinkMs: 300 },
  });
  expect(shoppers.statusCode).toBe(400);
  const exercise = await app.inject({
    method: 'POST',
    url: '/api/v1/experiments',
    payload: { scenario: 'host-firewall', durationSeconds: 12 },
  });
  expect(exercise.statusCode).toBe(400);
  const valid = await app.inject({
    method: 'POST',
    url: '/api/v1/feeder',
    payload: { shoppers: 30, concurrency: 4, seed: 42, thinkMs: 300 },
  });
  expect(valid.statusCode).toBe(200);
  expect(() => validateReply('/operator/api/v1/feeder', 'POST', valid.json())).not.toThrow();
});
