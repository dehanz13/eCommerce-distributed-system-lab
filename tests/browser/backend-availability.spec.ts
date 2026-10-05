import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';

// Transport fixtures exercise an independently running web process while ordering is unavailable, then recovers.
test('shop remains usable and shows a calm warning until ordering reads recover', async ({
  page,
}) => {
  let online = false;
  const shopperId = randomUUID();
  let cartRequests = 0;
  let checkoutRequests = 0;
  await page.route(/\/(api|ordering|fulfillment|operator)\//, async (route) => {
    if (!online) {
      await route.fulfill({
        status: 503,
        json: { code: 'DEPENDENCY_UNAVAILABLE', detail: 'Technical fixture failure' },
      });
      return;
    }
    const at = new Date().toISOString();
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/carts') cartRequests++;
    if (path === '/api/v1/checkouts') checkoutRequests++;
    const data =
      path === '/api/v1/carts'
        ? { id: randomUUID(), shopperId, revision: 0, createdAt: at, updatedAt: at, items: [] }
        : path === '/api/v1/products'
          ? [
              {
                id: randomUUID(),
                name: 'Recovery specimen',
                description: 'Fictional recovery test',
                priceCents: 200,
                availableStock: 2,
                active: true,
                createdAt: at,
                updatedAt: at,
              },
            ]
          : [];
    await route.fulfill({
      json: {
        data,
        meta: { requestId: randomUUID(), correlationId: randomUUID(), respondedAt: at },
      },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A small shop. A real journey.' })).toBeVisible();
  const warning = page.getByRole('alert').filter({ hasText: 'We’re having trouble connecting' });
  await expect(warning).toContainText(
    'We’re having trouble connecting to the shop right now. Please try again shortly.',
  );
  await expect(page.getByText('Technical fixture failure')).toHaveCount(0);
  await expect(
    page.getByText('Products could not be loaded. Please check the connection shortly.'),
  ).toBeVisible();
  await page.screenshot({ path: 'test-results/backend-unavailable.png' });
  online = true;
  await expect(warning).toHaveCount(0, { timeout: 20000 });
  await expect(page.getByRole('button', { name: 'Add Recovery specimen to cart' })).toBeEnabled();
  expect(cartRequests).toBeGreaterThan(0);
  expect(checkoutRequests).toBe(0);
});
