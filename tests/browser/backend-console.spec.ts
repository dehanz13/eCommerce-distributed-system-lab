import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

test('does not replay a quiet owner when another owner replaces its retained window', async ({
  page,
}) => {
  const at = new Date().toISOString();
  const quiet = {
    id: randomUUID(),
    owner: 'fulfillment',
    type: 'transaction.step',
    occurredAt: at,
  };
  const windows = Array.from({ length: 9 }, () =>
    Array.from({ length: 200 }, () => ({
      id: randomUUID(),
      owner: 'ordering',
      type: 'fixture.no_hop',
      occurredAt: at,
    })),
  );
  let batch = 0;
  await page.clock.install({ time: new Date(at) });
  await page.route('**/api/v1/backend', (route) => {
    const records = [quiet, ...windows[batch]!];
    return route.fulfill({
      json: {
        data: {
          sampledAt: at,
          topology: 'single',
          host: {},
          samples: [],
          activity: {
            records,
            limitPerOwner: 200,
            sources: ['ordering', 'fulfillment'].map((owner) => ({
              owner,
              available: true,
              records: records.filter((record) => record.owner === owner),
            })),
          },
        },
      },
    });
  });
  await page.addInitScript(() => {
    const state = window as typeof window & { replayIds: string[] };
    state.replayIds = [];
    window.addEventListener('DOMContentLoaded', () => {
      const status = document.getElementById('flow-status')!;
      let previous = '';
      new MutationObserver(() => {
        const id = status.dataset.observation ?? '';
        if (id && id !== previous) state.replayIds.push(id);
        previous = id;
      }).observe(status, { attributes: true });
    });
  });
  await page.goto('/architecture');
  await expect(page.locator('#flow-status')).toHaveAttribute('data-observation', quiet.id);
  await page.clock.runFor(1000);
  for (batch = 1; batch <= 8; batch++) {
    const response = page.waitForResponse('**/api/v1/backend');
    await page.locator('#refresh').click();
    await (await response).finished();
    await page.clock.runFor(1000);
  }
  expect(
    await page.evaluate(() => (window as typeof window & { replayIds: string[] }).replayIds),
  ).toEqual([quiet.id]);
});

test('replays same-millisecond processing before a later republish and duplicate delivery', async ({
  page,
}) => {
  const eventId = randomUUID();
  const publicationIds = [randomUUID(), randomUUID()];
  const deliveryIds = [randomUUID(), randomUUID()];
  const streams = { ordering: randomUUID(), fulfillment: randomUUID() };
  const start = Date.now() - 100;
  const records = (
    [
      ['ordering', 'event.publishing'],
      ['fulfillment', 'event.received'],
      ['fulfillment', 'event.acknowledged'],
      ['ordering', 'event.publishing'],
      ['fulfillment', 'event.received'],
      ['fulfillment', 'event.acknowledged'],
    ] satisfies Array<[string, string]>
  ).map(([owner, type], index) => ({
    id: randomUUID(),
    owner,
    type,
    eventId,
    streamId: streams[owner as keyof typeof streams],
    sequence: [1, 1, 2, 2, 3, 4][index],
    publicationId: publicationIds[index < 3 ? 0 : 1],
    deliveryId: owner === 'fulfillment' ? deliveryIds[index < 3 ? 0 : 1] : undefined,
    eventType: 'order.accepted',
    destinationQueue: 'lab.accepted',
    occurredAt: new Date(start).toISOString(),
  }));
  await page.route('**/api/v1/backend', (route) =>
    route.fulfill({
      json: {
        data: {
          sampledAt: new Date().toISOString(),
          topology: 'single',
          host: {},
          samples: ['ordering', 'fulfillment'].map((id) => ({
            id,
            available: true,
            sampledAt: new Date().toISOString(),
            data: { ready: true, database: true, broker: true },
          })),
          activity: {
            records: [...records].reverse(),
            sources: ['ordering', 'fulfillment'].map((owner) => ({
              owner,
              available: true,
              records,
            })),
          },
        },
      },
    }),
  );
  await page.addInitScript(() => {
    const state = window as typeof window & { replayIds: string[] };
    state.replayIds = [];
    window.addEventListener('DOMContentLoaded', () => {
      const status = document.getElementById('flow-status')!;
      new MutationObserver(() => {
        const id = status.dataset.observation;
        if (id && !state.replayIds.includes(id)) state.replayIds.push(id);
      }).observe(status, { attributes: true, childList: true });
    });
  });
  await page.goto('/architecture');
  await expect
    .poll(
      () =>
        page.evaluate(() => (window as typeof window & { replayIds: string[] }).replayIds.length),
      { timeout: 15000 },
    )
    .toBe(6);
  expect(
    await page.evaluate(() => (window as typeof window & { replayIds: string[] }).replayIds),
  ).toEqual(records.map(({ id }) => id));
});

// This page is served by an isolated operator process, with owner HTTP observations supplied by fixtures.
test('operator architecture is independent, zoomable, selectable and honest about outages and paused data', async ({
  page,
}) => {
  let down = false;
  let reads = 0;
  await page.clock.install({ time: new Date() });
  let flowRecords: (typeof record & { eventType?: string; destinationQueue?: string })[] = [];
  const at = new Date().toISOString();
  const record = {
    id: randomUUID(),
    owner: 'ordering',
    type: 'checkout.rejected',
    status: 409,
    occurredAt: at,
    streamId: randomUUID(),
    sequence: 1,
    correlationId: randomUUID(),
    detail: '<img src=x onerror=alert(1)>',
  };
  await page.route('**/api/v1/backend', async (route) => {
    reads++;
    await route.fulfill({
      json: {
        data: {
          sampledAt: new Date().toISOString(),
          topology: 'single',
          scope: 'Configured backend observations.',
          host: { scope: 'Operator host', logicalCpus: 8 },
          samples: [
            {
              id: 'ordering',
              available: !down,
              sampledAt: at,
              data: down ? null : { ready: true, database: true, broker: true },
              error: down ? 'Unavailable' : null,
            },
            {
              id: 'fulfillment',
              available: true,
              sampledAt: at,
              data: { ready: true, database: true },
              error: null,
            },
            { id: 'redis', available: true, sampledAt: at, data: { connected: true }, error: null },
            {
              id: 'rabbitmq',
              available: true,
              sampledAt: at,
              data: [
                { name: 'lab.accepted', ready: 3, unacknowledged: 1, consumers: 1 },
                { name: 'lab.outcomes', ready: 0, unacknowledged: 0, consumers: 1 },
                { name: 'lab.quarantine', ready: 2, unacknowledged: 0, consumers: 0 },
              ],
              error: null,
            },
            {
              id: 'toxiproxy',
              available: true,
              sampledAt: at,
              data: [{ name: 'lab-rabbitmq', enabled: true }],
              error: null,
            },
          ],
          activity: {
            sampledAt: at,
            exhaustive: false,
            limitPerOwner: 200,
            retentionDays: 7,
            records: down ? [] : [record, ...flowRecords],
            sources: [
              {
                owner: 'ordering',
                available: !down,
                sampledAt: at,
                records: down ? [] : [record, ...flowRecords],
                error: down ? 'Unavailable' : null,
              },
            ],
          },
        },
        meta: { requestId: randomUUID(), correlationId: randomUUID(), respondedAt: at },
      },
    });
  });
  await page.goto('/architecture');
  await expect(page.getByRole('heading', { name: 'Backend architecture console' })).toBeVisible();
  await expect(page.locator('#health-ordering')).toHaveText('Ready');
  await expect(page.locator('#health-client')).toHaveText('External');
  await expect(page.locator('#health-fulfillment-db')).toHaveText('Connected');
  await expect(page.locator('#health-ordering-db')).toHaveText('Connected');
  await expect(page.locator('[data-node="accepted"] .live-state')).toContainText(
    '3 ready · 1 pending ack · 1 consumers',
  );
  await page.locator('[data-node="fulfillment-db"]').click();
  await expect(page.locator('#details')).toContainText('Owning API database probe');
  await expect(page.locator('#details')).toContainText('fulfillment');
  await page.locator('[data-node="ordering"]').click();
  await expect(page.locator('[data-edge="client-ordering"] .edge-base')).toHaveAttribute(
    'marker-start',
    'url(#arrow)',
  );
  await expect(page.locator('[data-edge="route-accepted"] .edge-base')).not.toHaveAttribute(
    'marker-start',
    'url(#arrow)',
  );
  // Finish the initial warning replay, then hold time before introducing the next observed frame.
  await expect(page.locator('#flow-status')).toContainText('Replay idle');
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
  flowRecords = [
    {
      ...record,
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      type: 'http.received',
      status: 200,
    },
    {
      ...record,
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      type: 'event.publishing',
      eventType: 'order.accepted',
      destinationQueue: 'lab.accepted',
      status: 200,
    },
    {
      ...record,
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      type: 'event.published',
      eventType: 'order.accepted',
      destinationQueue: 'lab.accepted',
      status: 200,
    },
    {
      ...record,
      id: randomUUID(),
      occurredAt: new Date().toISOString(),
      type: 'transaction.step_failed',
      status: 500,
    },
  ].map((record, index) => ({ ...record, sequence: index + 2 }));
  // Hold the 650 ms frame while media emulation makes a browser round trip; CI scheduling must not expire it.
  await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
  await expect(page.locator('[data-edge="client-ordering"]')).toHaveAttribute(
    'data-flow',
    'request',
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('[data-edge="client-ordering"]')).toHaveAttribute(
    'data-active',
    'true',
  );
  expect(
    await page
      .locator('[data-edge="client-ordering"] .edge-flow')
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe('none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.clock.resume();
  await expect(page.locator('[data-edge="ordering-toxiproxy"]')).toHaveAttribute(
    'data-flow',
    'event',
  );
  await expect(page.locator('[data-edge="ordering-database"]')).toHaveAttribute(
    'data-flow',
    'failure',
    { timeout: 15000 },
  );
  await expect(page.locator('[data-edge="publish-accepted"]')).toHaveAttribute(
    'data-flow',
    'response',
    { timeout: 15000 },
  );
  await expect(page.locator('[data-edge="publish-accepted"]')).toHaveAttribute(
    'data-direction',
    'reverse',
  );
  await expect(page.locator('[data-edge="route-accepted"]')).toHaveAttribute('data-flow', 'event');
  await expect(page.locator('[data-edge="publish-outcomes"]')).toHaveAttribute('data-flow', 'idle');
  await expect(page.locator('#flow-status')).toContainText('650 ms/hop');
  await expect(page.locator('[data-node="ordering"] .value')).toContainText(
    'records each purchase once',
  );
  await page.screenshot({ path: 'test-results/backend-console-flow.png', fullPage: true });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  expect(
    await page
      .locator('[data-edge="ordering-database"] .edge-flow')
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe('none');
  await page.screenshot({ path: 'test-results/backend-console-flow-dark.png', fullPage: true });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });
  await page.waitForTimeout(4800);
  await expect(page.locator('[data-edge="client-ordering"]')).toHaveAttribute('data-flow', 'idle');
  await page.getByRole('button', { name: 'Pause observations', exact: true }).click();
  await expect(page.locator('#health-ordering')).toHaveText('Stale');
  const count = reads;
  await page.waitForTimeout(2200);
  expect(reads).toBe(count);
  await page.locator('[data-node=postgres]').click();
  await expect(page.locator('#selected-title')).toHaveText('PostgreSQL');
  await expect(page.locator('#log-source')).toContainText(
    'Native container stdout is not collected',
  );
  await page.locator('[data-node=ordering]').click();
  await page.getByLabel('Severity').selectOption('warnings');
  await expect(page.locator('#logs')).toContainText('checkout.rejected');
  await page.locator('#logs summary').click();
  await expect(page.locator('#logs pre')).toContainText('<img src=x onerror=alert(1)>');
  await expect(page.locator('#logs img')).toHaveCount(0);
  await page.getByLabel('Filter logs by correlation or submission reference').fill('no-match');
  await expect(page.locator('#logs')).toHaveText('No matching records in this bounded window.');
  await page.getByLabel('Filter logs by correlation or submission reference').fill('');
  const zoom = await page.locator('#zoom').textContent();
  await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
  expect(await page.locator('#zoom').textContent()).not.toBe(zoom);
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  await page.screenshot({ path: 'test-results/backend-console-desktop.png', fullPage: true });
  down = true;
  await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
  await expect(page.locator('#details')).toContainText('Unavailable');
  await page.getByRole('button', { name: 'Resume observations', exact: true }).click();
  await expect(page.locator('#health-ordering')).toHaveText('Unavailable');
  await expect(page.locator('#health-postgres')).toHaveText('Unknown');
  await expect(page.locator('#health-ordering-db')).toHaveText('Unknown');
  await expect(page.locator('#health-fulfillment-db')).toHaveText('Connected');
  await expect(page.locator('#logs')).toContainText('checkout.rejected');
  await expect(page.locator('#log-source')).toContainText('last collected records');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/backend-console-mobile.png', fullPage: true });
});

test('replays a fast recorded request in operation order with a distinct return color', async ({
  page,
}) => {
  const requestId = randomUUID(),
    transactionId = randomUUID(),
    correlationId = randomUUID();
  let records: Array<Record<string, unknown>> = [];
  await page.route('**/api/v1/backend', (route) =>
    route.fulfill({
      json: {
        data: {
          sampledAt: new Date().toISOString(),
          topology: 'single',
          scope: 'Ordered replay fixture.',
          host: {},
          samples: [
            {
              id: 'ordering',
              available: true,
              sampledAt: new Date().toISOString(),
              data: { ready: true, database: true, broker: true },
            },
          ],
          activity: {
            records,
            sources: [{ owner: 'ordering', available: true, records }],
            sampledAt: new Date().toISOString(),
          },
        },
      },
    }),
  );
  await page.goto('/architecture');
  await expect(page.locator('#health-ordering')).toHaveText('Ready');
  const start = Date.now() - 40;
  // Deliberately skew the return timestamps; matching request and SQL step IDs establish the necessary order.
  records = [
    { type: 'http.completed', occurredAt: new Date(start).toISOString() },
    {
      type: 'transaction.step_result',
      occurredAt: new Date(start + 5).toISOString(),
      transactionId,
      step: 1,
    },
    { type: 'http.received', occurredAt: new Date(start + 10).toISOString() },
    {
      type: 'transaction.step',
      occurredAt: new Date(start + 20).toISOString(),
      transactionId,
      step: 1,
    },
  ].map((record) => ({ ...record, id: randomUUID(), owner: 'ordering', requestId, correlationId }));
  await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
  await expect(page.locator('#flow-status')).toContainText('http.received');
  await expect(page.locator('[data-edge="client-ordering"]')).toHaveAttribute(
    'data-active',
    'true',
  );
  const requestColor = await page
    .locator('[data-edge="client-ordering"] .edge-base')
    .evaluate((element) => getComputedStyle(element).stroke);
  await expect(page.locator('#flow-status')).toContainText('transaction.step ·');
  await expect(page.locator('[data-edge="ordering-database"]')).toHaveAttribute(
    'data-direction',
    'forward',
  );
  await expect(page.locator('#flow-status')).toContainText('transaction.step_result');
  await expect(page.locator('[data-edge="ordering-database"]')).toHaveAttribute(
    'data-flow',
    'response',
  );
  await expect(page.locator('[data-edge="ordering-database"]')).toHaveAttribute(
    'data-direction',
    'reverse',
  );
  await expect(page.locator('#flow-status')).toContainText('http.completed');
  await expect(page.locator('[data-edge="client-ordering"]')).toHaveAttribute(
    'data-flow',
    'response',
  );
  const responseColor = await page
    .locator('[data-edge="client-ordering"] .edge-base')
    .evaluate((element) => getComputedStyle(element).stroke);
  expect(responseColor).not.toBe(requestColor);
  await page.screenshot({
    path: 'test-results/backend-console-response-replay.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Pause observations', exact: true }).click();
  await expect(page.locator('[data-edge="client-ordering"]')).toHaveAttribute('data-flow', 'idle');
  await page.waitForTimeout(800);
  await expect(page.locator('.edge[data-active="true"]')).toHaveCount(0);
});

test('owned database probes and queue counters distinguish failures, missing evidence and consumer roles', async ({
  page,
}) => {
  let database = true,
    broker = true,
    queuesPresent = true;
  const at = new Date().toISOString();
  const outcomeEventId = randomUUID();
  const records = [
    {
      id: randomUUID(),
      owner: 'fulfillment',
      type: 'event.published',
      eventType: 'fulfillment.completed',
      destinationQueue: 'lab.outcomes',
      occurredAt: at,
    },
    {
      id: randomUUID(),
      owner: 'fulfillment',
      type: 'event.received',
      eventType: 'order.accepted',
      occurredAt: at,
    },
    {
      id: randomUUID(),
      owner: 'ordering',
      type: 'event.acknowledged',
      eventType: 'fulfillment.completed',
      eventId: outcomeEventId,
      occurredAt: new Date(Date.parse(at) + 20).toISOString(),
    },
    {
      id: randomUUID(),
      owner: 'fulfillment',
      type: 'event.quarantined',
      sourceQueue: 'lab.accepted',
      occurredAt: at,
    },
    {
      id: randomUUID(),
      owner: 'ordering',
      type: 'event.received',
      eventType: 'fulfillment.completed',
      eventId: outcomeEventId,
      occurredAt: new Date(Date.parse(at) + 10).toISOString(),
    },
  ];
  await page.route('**/api/v1/backend', (route) =>
    route.fulfill({
      json: {
        data: {
          sampledAt: new Date().toISOString(),
          topology: 'single',
          scope: 'Controlled owner and broker observations.',
          host: {},
          samples: [
            {
              id: 'ordering',
              available: true,
              sampledAt: at,
              data: { ready: true, database: true, broker: true },
              error: null,
            },
            {
              id: 'fulfillment',
              available: true,
              sampledAt: at,
              data: { ready: database, database, broker: true },
              error: null,
            },
            {
              id: 'rabbitmq',
              available: broker,
              sampledAt: at,
              data: broker
                ? queuesPresent
                  ? [
                      { name: 'lab.accepted', ready: 4, unacknowledged: 2, consumers: 0 },
                      { name: 'lab.outcomes', ready: 0, unacknowledged: 0, consumers: 1 },
                      { name: 'lab.quarantine', ready: 1, unacknowledged: 0, consumers: 0 },
                    ]
                  : []
                : null,
              error: broker ? null : 'Unavailable',
            },
          ],
          activity: {
            sampledAt: at,
            exhaustive: false,
            limitPerOwner: 200,
            retentionDays: 7,
            records,
            sources: ['ordering', 'fulfillment'].map((owner) => ({
              owner,
              available: true,
              sampledAt: at,
              records: records.filter((record) => record.owner === owner),
              error: null,
            })),
          },
        },
        meta: { requestId: randomUUID(), correlationId: randomUUID(), respondedAt: at },
      },
    }),
  );
  // Record public replay-status changes so a short hop cannot be missed by assertion polling.
  await page.addInitScript(() => {
    const state = window as typeof window & {
      replayFrames: Array<{ hop: string; kind: string; operation: string; direction: string }>;
    };
    state.replayFrames = [];
    window.addEventListener('DOMContentLoaded', () => {
      const status = document.getElementById('flow-status')!;
      const seen = new Set<string>();
      new MutationObserver(() => {
        const key = status.dataset.observation + ':' + status.dataset.hop;
        if (!status.dataset.hop || seen.has(key)) return;
        seen.add(key);
        const edge = document.querySelector<SVGElement>('[data-edge="' + status.dataset.hop + '"]');
        state.replayFrames.push({
          hop: status.dataset.hop,
          kind: status.dataset.kind!,
          operation: status.textContent!.split(' · ')[3]!,
          direction: edge?.dataset.direction ?? '',
        });
      }).observe(status, { attributes: true, childList: true });
    });
  });
  await page.goto('/architecture');
  await expect(page.locator('#health-accepted')).toHaveText('No consumers');
  await expect(page.locator('#health-quarantine')).toHaveText('Available');
  await expect(page.locator('[data-node="accepted"] .live-state')).toContainText(
    '4 ready · 2 pending ack · 0 consumers',
  );
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          (
            window as typeof window & { replayFrames: Array<{ hop: string; operation: string }> }
          ).replayFrames.some(
            (frame) => frame.hop === 'consume-outcomes' && frame.operation === 'event.acknowledged',
          ),
        ),
      { timeout: 15000 },
    )
    .toBe(true);
  const frames = await page.evaluate(
    () =>
      (
        window as typeof window & {
          replayFrames: Array<{ hop: string; kind: string; operation: string; direction: string }>;
        }
      ).replayFrames,
  );
  expect(frames).toContainEqual({
    hop: 'publish-outcomes',
    kind: 'response',
    operation: 'event.published',
    direction: 'reverse',
  });
  expect(frames).toContainEqual({
    hop: 'consume-accepted',
    kind: 'event',
    operation: 'event.received',
    direction: 'forward',
  });
  expect(frames).toContainEqual({
    hop: 'consume-outcomes',
    kind: 'response',
    operation: 'event.acknowledged',
    direction: 'reverse',
  });
  expect(
    frames.findIndex(
      (frame) => frame.hop === 'consume-outcomes' && frame.operation === 'event.received',
    ),
  ).toBeLessThan(
    frames.findIndex(
      (frame) => frame.hop === 'consume-outcomes' && frame.operation === 'event.acknowledged',
    ),
  );
  expect(
    frames.some((frame) => frame.hop === 'quarantine-fulfillment' && frame.kind === 'failure'),
  ).toBe(true);
  await page.getByRole('button', { name: 'Message bus', exact: true }).click();
  await expect
    .poll(() => page.locator('#viewport').evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await page.locator('[data-node="outcomes"]').click();
  await expect(page.locator('#details')).toContainText('lab.outcomes');
  await expect(page.locator('#logs')).toContainText('event.published');
  await expect(page.locator('#logs')).toContainText('event.received');
  await expect(page.locator('#logs .record')).toHaveCount(3);
  await page.screenshot({ path: 'test-results/backend-console-message-bus.png', fullPage: true });
  database = false;
  await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
  await expect(page.locator('#health-fulfillment-db')).toHaveText('Unavailable');
  await expect(page.locator('#health-ordering-db')).toHaveText('Connected');
  queuesPresent = false;
  await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
  await expect(page.locator('#health-accepted')).toHaveText('Unknown');
  await expect(page.locator('[data-node="accepted"] .live-state')).toHaveText(
    'Queue counters unavailable',
  );
  broker = false;
  await page.getByRole('button', { name: 'Refresh now', exact: true }).click();
  await expect(page.locator('#health-outcomes')).toHaveText('Unavailable');
  await expect(page.locator('#health-exchange')).toHaveText('Unavailable');
});
