import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
test.beforeEach(async ({ request }) => {
  const response = await request.put('/fulfillment/api/v1/settings', {
    data: { preset: 'success', paused: false },
  });
  expect(response.ok()).toBeTruthy();
});
test('shop through recorded fulfillment and navigate admin', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'A small shop. A real journey.' })).toBeVisible();
  await page.getByRole('button', { name: 'Add Field notebook to cart' }).click();
  await page.getByRole('button', { name: 'Review checkout' }).click();
  await expect(page.getByRole('heading', { name: 'Confirm current prices' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirm order' }).click();
  await expect(page.getByText('fulfilled', { exact: true })).toBeVisible({ timeout: 15000 });
  await page.getByRole('link', { name: 'Catalog Admin' }).click();
  await expect(page.getByRole('heading', { name: 'Create product' })).toBeVisible();
  await page.getByRole('link', { name: 'System Dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'The data journey' })).toBeVisible();
  await page.getByRole('button', { name: 'Controls', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Named service controls' })).toBeVisible();
});
test('changed prices require reconfirmation and leave the cart intact', async ({ page }) => {
  const specimenName = 'Browser reconfirmation specimen ' + randomUUID().slice(0, 8);
  const created = await page.request.post('/api/v1/products', {
    data: {
      name: specimenName,
      description: 'Fictional',
      priceCents: 500,
      availableStock: 3,
    },
  });
  const product = (await created.json()).data;
  await page.goto('/');
  await page.getByRole('button', { name: `Add ${specimenName} to cart`, exact: true }).click();
  await page.getByRole('button', { name: 'Review checkout', exact: true }).click();
  await page.request.patch('/api/v1/products/' + product.id, { data: { priceCents: 600 } });
  await page.getByRole('button', { name: 'Confirm order', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Prices changed');
  await expect(
    page.getByRole('button', { name: `Remove ${specimenName}`, exact: true }),
  ).toBeVisible();
});
test('a committed checkout with a lost response is recovered using the saved submission', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add Travel mug to cart', exact: true }).click();
  await page.getByRole('button', { name: 'Review checkout', exact: true }).click();
  await page.route(
    '**/api/v1/checkouts',
    async (route) => {
      await route.fetch();
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Confirm order', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Recover submission', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Recover submission', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Order accepted');
});
test('exhausted fulfillment can create a cart for a fresh confirmation', async ({ page }) => {
  await page.request.put('/fulfillment/api/v1/settings', {
    data: { preset: 'fail', paused: false },
  });
  try {
    await page.goto('/');
    await page.getByRole('button', { name: 'Add Canvas tote to cart', exact: true }).click();
    await page.getByRole('button', { name: 'Review checkout', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm order', exact: true }).click();
    await expect(page.getByText('failed', { exact: true })).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Create recovery cart', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Recovery cart created');
    await page.getByRole('button', { name: 'Review checkout', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Confirm current prices' })).toBeVisible();
  } finally {
    await page.request.put('/fulfillment/api/v1/settings', {
      data: { preset: 'success', paused: false },
    });
  }
});
test('architecture follows real hops, replays history and marks paused observations stale', async ({
  page,
}) => {
  await page.goto('/system');
  await page.getByRole('button', { name: 'Architecture', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'The ecosystem, in motion' })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('button', { name: 'Run demo checkout', exact: true }).click();
  // Wait for this submission, rather than accepting the previous journey's completed bar.
  await expect(
    page.getByText(/^Order .* accepted\. Follow its observed journey below\.$/),
  ).toBeVisible();
  const progress = page.getByRole('progressbar', { name: 'Observed journey milestones' });
  await expect(progress).toHaveAttribute('aria-valuenow', '100', { timeout: 15000 });
  await expect(page.getByText('11 / 11 milestones observed', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/architecture-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Replay observed hops', exact: true }).click();
  await expect(page.getByText('Replay · recorded history', { exact: true })).toBeVisible();
  await expect(progress).toHaveAttribute('aria-valuenow', '100', { timeout: 15000 });
  await page.getByRole('button', { name: 'Pause refresh', exact: true }).click();
  await expect(
    page.getByText('Refresh paused: showing the last observed state.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Resume refresh', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Run demo checkout', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('architecture preserves an unknown demo submission for explicit idempotent recovery', async ({
  page,
}) => {
  await page.goto('/system');
  await page.getByRole('button', { name: 'Architecture', exact: true }).click();
  await page.route(
    '**/api/v1/checkouts',
    async (route) => {
      await route.fetch();
      await route.abort('failed');
    },
    { times: 1 },
  );
  await page.getByRole('button', { name: 'Run demo checkout', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Recover demo submission', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Outcome unknown. Recover the original submission using the saved key.', {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Recover demo submission', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Recover demo submission', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole('progressbar', { name: 'Observed journey milestones' }),
  ).toHaveAttribute('aria-valuenow', '100', { timeout: 15000 });
});
test('architecture shows broker outage, preserves pending work and resumes the same journey', async ({
  page,
  request,
}) => {
  async function brokerAction(name: string) {
    const response = await request.post('/operator/api/v1/actions', {
      data: { name, service: 'rabbitmq' },
    });
    expect(response.status()).toBe(202);
    const action = (await response.json()).data;
    await expect
      .poll(
        async () =>
          (await (await request.get('/operator/api/v1/actions/' + action.id)).json()).data.status,
        { timeout: 20000 },
      )
      .toBe('completed');
  }
  await brokerAction('stop');
  try {
    await page.goto('/system');
    await page.getByRole('button', { name: 'Architecture', exact: true }).click();
    await expect(page.getByText('Degraded or unavailable:', { exact: false })).toBeVisible({
      timeout: 15000,
    });
    await page.getByRole('button', { name: 'Run demo checkout', exact: true }).click();
    await expect(page.getByText('3 / 11 milestones observed', { exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByText('Awaiting observed outcome', { exact: true })).toBeVisible();
  } finally {
    await brokerAction('start');
  }
  await expect(
    page.getByRole('progressbar', { name: 'Observed journey milestones' }),
  ).toHaveAttribute('aria-valuenow', '100', { timeout: 15000 });
});
