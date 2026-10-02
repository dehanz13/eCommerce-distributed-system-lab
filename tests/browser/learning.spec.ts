import { test, expect } from '@playwright/test';
test('cache learning controls expose real miss, hit and invalid JSON recovery', async ({
  page,
}) => {
  await page.goto('/system');
  await page.getByRole('button', { name: 'Cache', exact: true }).click();
  await page.getByRole('button', { name: 'Clear current key' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Request completed' })).toBeVisible();
  await page.getByRole('button', { name: 'Read catalog', exact: true }).click();
  await expect(page.getByText('cache.filled', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Read catalog', exact: true }).click();
  await expect(page.getByText('cache.hit', { exact: true }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Inject invalid JSON' }).click();
  await expect(page.getByRole('button', { name: 'Read catalog', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Read catalog', exact: true }).click();
  await expect(page.getByText('cache.invalid', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/cache-learning.png', fullPage: true });
});
test('shopper population creates real cart and checkout outcomes', async ({ page }) => {
  await page.goto('/system');
  await page.getByRole('button', { name: 'Shoppers', exact: true }).click();
  await page.getByLabel('Shoppers', { exact: true }).fill('8');
  await page.getByLabel('Concurrency', { exact: true }).fill('2');
  const accepted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/api/v1/feeder'),
  );
  await page.getByRole('button', { name: 'Start shoppers' }).click();
  const response = await accepted;
  expect(response.status()).toBe(202);
  const { data: startedRun } = await response.json();
  expect(startedRun.id).toEqual(expect.any(String));
  // A previous terminal run remains visible until the next dashboard observation arrives.
  await expect(
    page.locator('details').filter({ hasText: 'Retained unresolved submissions and run metadata' }),
  ).toContainText(startedRun.id);
  await expect(page.getByText('completed · 8 / 8 shoppers finished', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('button', { name: 'Inspect journey' }).first()).toBeVisible();
  await page.screenshot({ path: 'test-results/shopper-population.png', fullPage: true });
  await page.getByRole('button', { name: 'Inspect journey' }).first().click();
  await expect(page.getByLabel('Filter by correlation ID')).not.toHaveValue('');
});
test('map pieces provide keyboard and hover explanations in an even grid', async ({ page }) => {
  await page.goto('/system');
  await page.getByRole('button', { name: 'Architecture', exact: true }).click();
  const cache = page.getByRole('button', { name: /Catalog cache/ });
  await cache.focus();
  await expect(page.locator('#help-redis')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Learn by changing one thing' })).toBeVisible();
  const pieces = page.locator('.architecture-piece');
  await expect(pieces).toHaveCount(8);
  const positions = await pieces.evaluateAll((nodes) =>
    nodes.map((node) => ({
      x: (node as HTMLElement).offsetLeft,
      y: (node as HTMLElement).offsetTop,
    })),
  );
  expect(positions.filter((x) => x.y === 26).map((x) => x.x)).toEqual([24, 260, 496, 732]);
  expect(
    positions
      .filter((x) => x.y === 254)
      .map((x) => x.x)
      .sort((a, b) => a - b),
  ).toEqual([24, 260, 496, 732]);
  await page.screenshot({ path: 'test-results/architecture-learning.png', fullPage: true });
});
test('failure lab records and restores a scoped network interruption', async ({ page }) => {
  await page.goto('/system');
  await page.getByRole('button', { name: 'Failure Lab', exact: true }).click();
  await page.getByRole('combobox', { name: 'Exercise', exact: true }).selectOption('network-cut');
  await page.getByLabel('Active duration (seconds)').fill('3');
  const accepted = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname.endsWith('/api/v1/experiments'),
  );
  await page.getByRole('button', { name: 'Engage exercise' }).click();
  const response = await accepted;
  expect(response.status()).toBe(202);
  const { data: startedRun } = await response.json();
  expect(startedRun.id).toEqual(expect.any(String));
  await expect(
    page.locator('details').filter({ hasText: 'Run identifiers and timestamps' }),
  ).toContainText(startedRun.id);
  await expect(page.getByText('completed · restoration completed', { exact: true })).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByText('Before engagement', { exact: true })).toBeVisible();
  await expect(page.getByText('During engagement', { exact: true })).toBeVisible();
  await expect(page.getByText('After restoration', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/failure-lab.png', fullPage: true });
});
