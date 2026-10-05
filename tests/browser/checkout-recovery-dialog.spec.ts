import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

// HTTP fixtures prove that reconnecting/dismissing never replays an unresolved checkout.
test('saved checkout explains uncertainty and recovers only on explicit choice with the original body/key', async ({
  page,
}) => {
  const shopperId = randomUUID();
  const correlationId = randomUUID();
  const pending = {
    key: randomUUID(),
    correlationId,
    body: { cartId: randomUUID(), revision: 2, priceFingerprint: 'a'.repeat(64) },
  };
  await page.addInitScript(
    ({ shopperId, pending }) => {
      if (!sessionStorage.getItem('recovery-fixture')) {
        localStorage.setItem('lab.shopper', shopperId);
        localStorage.setItem('lab.checkout', JSON.stringify(pending));
        sessionStorage.setItem('recovery-fixture', 'initialized');
      }
    },
    { shopperId, pending },
  );
  let writes = 0;
  let recoverOnline = false;
  await page.route(/\/(api|ordering|fulfillment|operator)\//, async (route) => {
    const path = new URL(route.request().url()).pathname;
    const at = new Date().toISOString();
    let data: unknown = [];
    if (path === '/api/v1/carts')
      data = {
        id: pending.body.cartId,
        shopperId,
        revision: 2,
        createdAt: at,
        updatedAt: at,
        items: [],
      };
    if (path === '/api/v1/checkouts') {
      writes++;
      expect(route.request().postDataJSON()).toEqual(pending.body);
      expect(route.request().headers()['idempotency-key']).toBe(pending.key);
      expect(route.request().headers()['x-correlation-id']).toBe(correlationId);
      if (!recoverOnline) {
        await route.fulfill({
          status: 503,
          json: { code: 'DEPENDENCY_UNAVAILABLE', detail: 'Fixture outage' },
        });
        return;
      }
      data = {
        id: randomUUID(),
        shopperId,
        status: 'accepted',
        totalCents: 0,
        correlationId,
        createdAt: at,
        updatedAt: at,
        fulfilledAt: null,
        failedAt: null,
        items: [],
      };
    }
    await route.fulfill({
      json: {
        data,
        meta: { requestId: randomUUID(), correlationId, respondedAt: at },
      },
    });
  });
  await page.goto('/');
  const dialog = page.getByRole('dialog', { name: 'We couldn’t confirm your checkout' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Your order may already have been accepted');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  expect(writes).toBe(0);
  expect(await page.evaluate(() => !!localStorage.getItem('lab.checkout'))).toBe(true);
  await page.reload();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Recover saved checkout' }).click();
  await expect(dialog).toContainText('Your order may already have been accepted');
  await expect(dialog.getByRole('button', { name: 'Recover saved checkout' })).toBeEnabled();
  expect(writes).toBe(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(dialog).toBeVisible();
  await page.screenshot({ path: 'test-results/checkout-recovery-modal.png' });
  recoverOnline = true;
  await dialog.getByRole('button', { name: 'Recover saved checkout' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Order accepted');
  expect(writes).toBe(2);
  expect(await page.evaluate(() => localStorage.getItem('lab.checkout'))).toBe(null);
});
