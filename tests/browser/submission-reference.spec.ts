import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

// Isolated HTTP fixtures verify navigation and grouping without operating the lab.
test('shopper follows one reference across recovery correlations in the dashboard', async ({
  page,
}) => {
  const reference = 'a'.repeat(64);
  const correlationId = randomUUID();
  const replayCorrelation = randomUUID();
  const orderId = randomUUID();
  const shopperId = randomUUID();
  const at = new Date().toISOString();
  const order = {
    id: orderId,
    shopperId,
    status: 'fulfilled',
    totalCents: 100,
    correlationId,
    submissionReference: reference,
    createdAt: at,
    updatedAt: at,
    fulfilledAt: at,
    failedAt: null,
    items: [
      {
        id: randomUUID(),
        orderId,
        productId: randomUUID(),
        name: 'Journey specimen',
        priceCents: 100,
        quantity: 1,
        createdAt: at,
      },
    ],
  };
  const logs = [
    {
      id: randomUUID(),
      owner: 'ordering',
      type: 'checkout.committed',
      occurredAt: at,
      correlationId,
      submissionReference: reference,
      orderId,
    },
    {
      id: randomUUID(),
      owner: 'ordering',
      type: 'checkout.recovered',
      occurredAt: at,
      correlationId: replayCorrelation,
      submissionReference: reference,
      orderId,
    },
    {
      id: randomUUID(),
      owner: 'ordering',
      type: 'outcome.applied',
      eventType: 'fulfillment.completed',
      occurredAt: at,
      correlationId,
      submissionReference: reference,
      orderId,
    },
  ];
  await page.route(/\/(api|operator|ordering|fulfillment)\//, async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = {};
    if (path === '/api/v1/products') data = [];
    else if (path === '/api/v1/carts')
      data = { id: randomUUID(), shopperId, revision: 0, createdAt: at, updatedAt: at, items: [] };
    else if (path === '/api/v1/orders') data = [order];
    else if (path === '/ordering/activity') data = logs;
    else if (path.endsWith('/activity') || path.endsWith('/actions')) data = [];
    else if (path.endsWith('/feeder') || path.endsWith('/resources')) data = null;
    else if (path.endsWith('/experiments')) data = { scenarios: {}, run: null };
    else if (path === '/operator/api/v1/status') data = { services: [] };
    else if (path.endsWith('/metrics')) data = { metrics: [] };
    await route.fulfill({
      json: {
        data,
        meta: { requestId: randomUUID(), correlationId, respondedAt: new Date().toISOString() },
      },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Follow this order' })).toBeVisible();
  await page.getByRole('link', { name: 'Follow this order' }).click();
  await expect(page).toHaveURL(new RegExp('/system\\?submission=' + reference));
  await expect(page.getByText('Checkout key reference', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Architecture', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('dd').filter({ hasText: reference })).toBeVisible();
  await expect(page.locator('dd').filter({ hasText: replayCorrelation })).toContainText(
    correlationId,
  );
  await expect(page.getByLabel('Journey').locator('option')).toHaveCount(1);
  await expect(page.getByText('fulfilled', { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel('Follow newest')).not.toBeChecked();
  await page.getByText('Checkout key reference', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/submission-reference-desktop.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('dd').filter({ hasText: reference })).toBeVisible();
  await page.getByText('Checkout key reference', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/submission-reference-mobile.png' });
});
