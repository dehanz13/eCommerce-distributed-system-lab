import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { request, ApiError } from '@lab/client';
import type { Cart, Product, Preview, Order, FeederOptions, FeederRun } from '@lab/contracts';
import { cfg, root, activity, Problem } from '@lab/runtime';
import { seededRandom, shopperBehavior } from './shopper-behavior';
const file = path.join(root, '.lab/feeder.json');
let current: FeederRun | null = null;
try {
  current = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (current && ['running', 'stopping'].includes(current.status)) {
    current.status = 'interrupted';
    current.finishedAt = new Date().toISOString();
    current.error =
      'Operator restarted. Check orders and recover retained unknown submissions explicitly.';
    save();
  }
} catch {
  current = null;
}
function save() {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + '.tmp';
  fs.writeFileSync(temporary, JSON.stringify(current), { mode: 0o600 });
  fs.renameSync(temporary, file);
}
export const feeder = {
  busy: () => !!current && ['running', 'stopping'].includes(current.status),
  inspect: () => current,
  stop() {
    if (current?.status === 'running') {
      current.status = 'stopping';
      save();
    }
    return current;
  },
  async recover(key: string) {
    if (feeder.busy())
      throw new Problem(409, 'FEEDER_RUNNING', 'Stop active shoppers before recovery');
    const run = current;
    const submission = run?.unresolved.find((x) => x.key === key);
    if (!run || !submission)
      throw new Problem(
        404,
        'SUBMISSION_NOT_FOUND',
        'This retained submission is no longer pending',
      );
    try {
      const order = (
        await request<Order>(
          '/api/v1/checkouts',
          {
            method: 'POST',
            body: JSON.stringify(submission.body),
            headers: {
              'idempotency-key': submission.key,
              'x-correlation-id': submission.correlationId,
            },
          },
          cfg.ORDERING_URL,
        )
      ).data;
      run.unresolved = run.unresolved.filter((x) => x.key !== key);
      run.outcomes = run.outcomes.filter((x) => x.shopperId !== submission.shopperId);
      run.outcomes.push({
        shopperId: submission.shopperId,
        correlationId: submission.correlationId,
        outcome: 'recovered',
        orderId: order.id,
      });
      run.outcomes = run.outcomes.slice(-200);
      run.accepted++;
      run.unknown = Math.max(0, run.unknown - 1);
      save();
      return run;
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
        run.unresolved = run.unresolved.filter((x) => x.key !== key);
        run.unknown = Math.max(0, run.unknown - 1);
        run.rejected++;
        save();
      }
      throw e;
    }
  },
  start(options: FeederOptions) {
    if (feeder.busy())
      throw new Problem(409, 'FEEDER_RUNNING', 'Stop or finish the current shopper run');
    if (current?.unresolved.length)
      throw new Problem(
        409,
        'RECOVERY_REQUIRED',
        'Recover the retained checkout submissions before starting another run',
      );
    const run: FeederRun = {
      id: randomUUID(),
      options,
      status: 'running',
      requestedAt: new Date().toISOString(),
      finishedAt: null,
      started: 0,
      finished: 0,
      active: 0,
      accepted: 0,
      abandoned: 0,
      rejected: 0,
      unknown: 0,
      requestCount: 0,
      requestErrors: 0,
      totalRequestMs: 0,
      outcomes: [],
      unresolved: [],
    };
    current = run;
    save();
    void simulate(run)
      .catch((e) => {
        run.error = String(e);
      })
      .finally(() => {
        run.status = run.status === 'stopping' ? 'stopped' : 'completed';
        run.finishedAt = new Date().toISOString();
        save();
        activity('operator', 'feeder.finished', {
          runId: run.id,
          accepted: run.accepted,
          unknown: run.unknown,
        });
      });
    return run;
  },
};
async function simulate(run: FeederRun) {
  const random = seededRandom(run.options.seed);
  const plans = Array.from({ length: run.options.shoppers }, () => ({
    ...shopperBehavior(random),
    index: Math.floor(random() * 3),
    delay: Math.floor(random() * run.options.thinkMs),
  }));
  async function call<T>(
    route: string,
    method = 'GET',
    body?: unknown,
    correlationId?: string,
    key?: string,
  ) {
    const start = performance.now();
    run.requestCount++;
    try {
      return (
        await request<T>(
          route,
          {
            method,
            headers: {
              ...(correlationId ? { 'x-correlation-id': correlationId } : {}),
              ...(key ? { 'idempotency-key': key } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
          },
          cfg.ORDERING_URL,
        )
      ).data;
    } catch (e) {
      run.requestErrors++;
      throw e;
    } finally {
      run.totalRequestMs += performance.now() - start;
      save();
    }
  }
  // Run-owned catalog items keep load generation from silently restocking user products.
  const products: Product[] = [];
  for (let i = 0; i < 3; i++)
    products.push(
      await call<Product>('/api/v1/products', 'POST', {
        name: `Shopper run ${run.id.slice(0, 8)} · item ${i + 1}`,
        description: 'Fictional traffic product; retained for historical order inspection.',
        priceCents: 500 + i * 700,
        availableStock: run.options.shoppers * 3,
      }),
    );
  activity('operator', 'feeder.started', { runId: run.id, ...run.options });
  let cursor = 0;
  await Promise.all(
    Array.from({ length: run.options.concurrency }, async () => {
      while (run.status === 'running' && cursor < plans.length) {
        const plan = plans[cursor++]!;
        const shopperId = randomUUID(),
          correlationId = randomUUID();
        run.started++;
        run.active++;
        save();
        let submission: FeederRun['unresolved'][number] | undefined;
        let checkoutStarted = false;
        try {
          await call<Product[]>('/api/v1/products', 'GET', undefined, correlationId);
          const cart = await call<Cart>('/api/v1/carts', 'POST', { shopperId }, correlationId);
          await call<Cart>(
            `/api/v1/carts/${cart.id}/items/${products[plan.index]!.id}`,
            'PUT',
            { quantity: plan.quantity },
            correlationId,
          );
          await new Promise((resolve) => setTimeout(resolve, plan.delay));
          if (plan.abandons) {
            run.abandoned++;
            run.outcomes.push({ shopperId, correlationId, outcome: 'abandoned' });
          } else {
            const preview = await call<Preview>(
              `/api/v1/carts/${cart.id}/preview`,
              'GET',
              undefined,
              correlationId,
            );
            submission = {
              shopperId,
              correlationId,
              key: randomUUID(),
              body: {
                cartId: cart.id,
                revision: preview.revision,
                priceFingerprint: preview.priceFingerprint,
              },
            };
            // Persist the exact submission before sending. An interrupted send stays recoverable.
            run.unresolved.push(submission);
            save();
            checkoutStarted = true;
            const order = await call<Order>(
              '/api/v1/checkouts',
              'POST',
              submission.body,
              correlationId,
              submission.key,
            );
            run.unresolved = run.unresolved.filter((x) => x.key !== submission!.key);
            run.accepted++;
            run.outcomes.push({ shopperId, correlationId, outcome: 'accepted', orderId: order.id });
          }
        } catch (e) {
          const unknown =
            checkoutStarted && (!(e instanceof ApiError) || e.status === 0 || e.status >= 500);
          if (unknown) run.unknown++;
          else {
            run.rejected++;
            if (submission)
              run.unresolved = run.unresolved.filter((x) => x.key !== submission!.key);
          }
          run.outcomes.push({
            shopperId,
            correlationId,
            outcome: unknown ? 'outcome unknown' : 'rejected',
            code: e instanceof ApiError ? e.code : 'TRANSPORT_ERROR',
          });
        } finally {
          run.active--;
          run.finished++;
          run.outcomes = run.outcomes.slice(-200);
          save();
        }
      }
    }),
  );
}
