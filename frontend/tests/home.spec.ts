import { expect, test } from '@playwright/test';
import runsFixture from './fixtures/runs.json' with { type: 'json' };
import { mockApi } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('home page loads with header and chart controls', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('banner')).toBeVisible();
  await expect(page.locator('.header-logo')).toBeVisible();

  // Chart date range controls appear once data resolves
  await expect(page.getByRole('button', { name: 'Last 7 days' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Last 30 days' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'All time' })).toBeVisible();
});

test('date range filter updates active state', async ({ page }) => {
  await page.goto('/');

  const sevenDays = page.getByRole('button', { name: 'Last 7 days' });
  const thirtyDays = page.getByRole('button', { name: 'Last 30 days' });

  // Default is 30 days
  await expect(thirtyDays).toHaveClass(/active/);

  await sevenDays.click();
  await expect(sevenDays).toHaveClass(/active/);
  await expect(thirtyDays).not.toHaveClass(/active/);
});

test('theme toggle switches between light and dark', async ({ page }) => {
  await page.goto('/');

  const desktopNav = page.locator('.header-nav-desktop');
  const themeToggle = desktopNav.getByRole('button', { name: 'Toggle theme' });
  await expect(themeToggle).toBeVisible();

  const htmlEl = page.locator('html');
  const initialTheme = await htmlEl.getAttribute('data-theme');

  await themeToggle.click();

  const newTheme = await htmlEl.getAttribute('data-theme');
  expect(newTheme).not.toBe(initialTheme);
  expect(['dark', 'light']).toContain(newTheme);
});

test('page has accessible skip-to-content link', async ({ page }) => {
  await page.goto('/');

  // Skip link exists (visually hidden until focused); screen readers can still reach it.
  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skipLink).toBeAttached();
});

test('navigates to about page and renders its content', async ({ page }) => {
  await page.goto('/');

  const desktopNav = page.locator('.header-nav-desktop');
  await desktopNav.getByRole('link', { name: 'About' }).click();

  await expect(page).toHaveURL('/about');
  await expect(page.getByRole('heading', { name: 'What is this?' })).toBeVisible();
});

test('error state retry button refetches data successfully', async ({ page }) => {
  // Clear the mockApi handler so our fail-then-succeed mock is the only one.
  await page.unroute('**/api/historical/summary**');

  let callCount = 0;
  await page.route('**/api/historical/summary**', async (route) => {
    callCount++;
    if (callCount === 1) {
      // Abort forces fetch() itself to reject, which unambiguously triggers
      // the error state. Status 500 was flaky here — the response landed
      // but the app stayed in loading.
      await route.abort('failed');
    } else {
      await route.fulfill({ json: runsFixture });
    }
  });

  await page.goto('/');

  // ErrorState renders on failure
  await expect(page.getByText('Failed to load benchmark data')).toBeVisible();

  const retryButton = page.getByRole('button', { name: /try again/i });
  await expect(retryButton).toBeVisible();
  await retryButton.click();

  // After retry, normal chart controls reappear
  await expect(page.getByRole('button', { name: 'Last 30 days' })).toBeVisible();
  expect(callCount).toBe(2);
});
