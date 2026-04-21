import { expect, test } from '@playwright/test';
import { mockApi } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  // Hamburger + mobile nav are hidden at desktop widths.
  await page.setViewportSize({ width: 375, height: 667 });
});

test('hamburger opens the mobile nav', async ({ page }) => {
  await page.goto('/');

  const hamburger = page.getByRole('button', { name: 'Toggle menu' });
  const mobileNav = page.locator('.mobile-nav');

  await expect(mobileNav).not.toHaveClass(/is-open/);
  await expect(hamburger).toHaveAttribute('aria-expanded', 'false');

  await hamburger.click();

  await expect(mobileNav).toHaveClass(/is-open/);
  await expect(hamburger).toHaveAttribute('aria-expanded', 'true');
});

test('close button inside mobile nav dismisses it', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Toggle menu' }).click();

  const mobileNav = page.locator('.mobile-nav');
  await expect(mobileNav).toHaveClass(/is-open/);

  await page.locator('.mobile-nav-close').click();

  await expect(mobileNav).not.toHaveClass(/is-open/);
});

test('clicking the overlay dismisses mobile nav', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Toggle menu' }).click();

  const mobileNav = page.locator('.mobile-nav');
  await expect(mobileNav).toHaveClass(/is-open/);

  // Mobile-nav slides in from the left (280px wide), so click far to the right
  // to hit the overlay rather than the nav panel.
  await page.locator('.mobile-overlay').click({ position: { x: 350, y: 300 } });

  await expect(mobileNav).not.toHaveClass(/is-open/);
});

test('clicking a mobile nav link closes the menu and navigates', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Toggle menu' }).click();

  const mobileNav = page.locator('.mobile-nav');
  await expect(mobileNav).toHaveClass(/is-open/);

  await mobileNav.getByRole('link', { name: 'About' }).click();

  await expect(page).toHaveURL('/about');
  await expect(mobileNav).not.toHaveClass(/is-open/);
});
