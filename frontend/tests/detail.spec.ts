import { expect, test } from '@playwright/test';
import { mockApi } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('detail view renders machine performance cards', async ({ page }) => {
  await page.goto('/run/2026-04-01');

  // One card per machine in the fixture (blueberry, ripley)
  await expect(page.getByText('blueberry').first()).toBeVisible();
  await expect(page.getByText('ripley').first()).toBeVisible();

  // Geomean labels appear on performance cards
  await expect(page.getByText('geometric mean').first()).toBeVisible();
});

test('tailcall badge appears for machines where it is enabled', async ({ page }) => {
  await page.goto('/run/2026-04-05');

  // Fixture has has_tailcall: true for blueberry on 2026-04-05
  await expect(page.getByText('tail calls')).toBeVisible();
});

test('machine tabs let user switch between machines', async ({ page }) => {
  await page.goto('/run/2026-04-01');

  const blueberryTab = page.getByRole('button', { name: /^blueberry/ });
  const ripleyTab = page.getByRole('button', { name: /^ripley/ });
  const compareTab = page.getByRole('button', { name: 'Compare' });

  await expect(blueberryTab).toBeVisible();
  await expect(ripleyTab).toBeVisible();
  await expect(compareTab).toBeVisible();

  await ripleyTab.click();
  await expect(ripleyTab).toHaveClass(/active/);
});

test('benchmark table renders rows for selected machine', async ({ page }) => {
  await page.goto('/run/2026-04-01');

  // Blueberry tab is selected by default; fixture has 2to3, nbody, pidigits
  const table = page.getByRole('table');
  await expect(table).toBeVisible();

  await expect(table.getByRole('cell', { name: '2to3', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'nbody', exact: true })).toBeVisible();
});

test('clicking column header toggles benchmark table sort', async ({ page }) => {
  await page.goto('/run/2026-04-01');

  const table = page.getByRole('table');
  const nameCells = table.locator('tbody tr td:first-child');

  // Need at least two rows to observe a reorder.
  await expect(nameCells.first()).not.toBeEmpty();
  const ascending = await nameCells.allTextContents();
  expect(ascending.length).toBeGreaterThan(1);

  // Click name header to toggle ASC → DESC.
  await page.getByRole('columnheader', { name: /Benchmark Name/i }).click();

  // Wait for the reorder to apply before reading back.
  await expect(nameCells.first()).toHaveText(ascending[ascending.length - 1]);

  const descending = await nameCells.allTextContents();
  expect(descending).toEqual([...ascending].reverse());
});

test('benchmark search filters rows', async ({ page }) => {
  await page.goto('/run/2026-04-01');

  const table = page.getByRole('table');
  await expect(table.getByRole('cell', { name: 'nbody', exact: true })).toBeVisible();

  await page.getByPlaceholder('Search benchmarks...').fill('2to3');

  await expect(table.getByRole('cell', { name: '2to3', exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: 'nbody', exact: true })).not.toBeVisible();
});

test('compare tab shows all machines as columns', async ({ page }) => {
  await page.goto('/run/2026-04-01');

  await page.getByRole('button', { name: 'Compare' }).click();

  // Compare table should have a column header for each machine
  await expect(page.getByRole('columnheader', { name: /blueberry/ })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: /ripley/ })).toBeVisible();
});

test('benchmark table is horizontally scrollable on small screens', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/run/2026-04-01');

  const tableWrapper = page.locator('.table-wrapper');
  await expect(tableWrapper).toBeVisible();

  // Content wider than viewport is the precondition for any horizontal scroll.
  const { scrollWidth, clientWidth } = await tableWrapper.evaluate((el) => ({
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
  }));
  expect(scrollWidth).toBeGreaterThan(clientWidth);

  // Programmatic scroll proves the wrapper actually scrolls (not clipped).
  await tableWrapper.evaluate((el) => {
    el.scrollLeft = 0;
    el.scrollBy({ left: 100 });
  });
  const scrollLeft = await tableWrapper.evaluate((el) => el.scrollLeft);
  expect(scrollLeft).toBeGreaterThan(0);
});

test('missing date shows empty state', async ({ page }) => {
  // Override the date endpoint to return no machines for this test
  await page.route('**/api/historical/date/**', async (route) => {
    await route.fulfill({ json: { days: 0, machines: {} } });
  });

  await page.goto('/run/2020-01-01');

  await expect(page.getByText('No data found for this date.')).toBeVisible();
  await expect(page.getByRole('link', { name: '← Back to Home' })).toBeVisible();
});
