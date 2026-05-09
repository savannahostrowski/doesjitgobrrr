import { expect, test } from '@playwright/test';
import eventsFixture from './fixtures/events.json' with { type: 'json' };
import { mockApi } from './helpers';

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test('changes toggle is off by default and visible in chart controls', async ({
  page,
}) => {
  await page.goto('/');
  const toggle = page.getByRole('button', { name: /^Changes/ });
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
});

test('toggle on activates aria-pressed and syncs ?changes=1 to URL', async ({
  page,
}) => {
  await page.goto('/');
  const toggle = page.getByRole('button', { name: /^Changes/ });

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page).toHaveURL(/[?&]changes=1/);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page).not.toHaveURL(/[?&]changes=1/);
});

test('?changes=1 in URL turns the toggle on at load time', async ({ page }) => {
  await page.goto('/?changes=1');
  const toggle = page.getByRole('button', { name: /^Changes/ });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});

test('legacy ?annotations=1 still activates the toggle (back-compat)', async ({
  page,
}) => {
  await page.goto('/?annotations=1');
  const toggle = page.getByRole('button', { name: /^Changes/ });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});

test('info icon exposes the date-convention tooltip on hover', async ({
  page,
}) => {
  await page.goto('/');
  const infoIcon = page.getByRole('img', { name: 'About change dates' });
  await expect(infoIcon).toBeVisible();

  // Tooltip is in DOM but hidden until hover/focus.
  const tooltip = page.locator('.annotations-info-tooltip');
  await expect(tooltip).toHaveCSS('visibility', 'hidden');

  await infoIcon.hover();
  await expect(tooltip).toHaveCSS('visibility', 'visible');
  await expect(tooltip).toContainText('11 PM UTC');
});

test('SR-accessible changes list appears when toggle is on and lists every change', async ({
  page,
}) => {
  await page.goto('/?changes=1');

  // The list is visually hidden (1×1px) until focused — that's intentional
  // (keyboard-only fallback). Focus + Enter expands it the same way a
  // keyboard or screen-reader user would.
  const summary = page.locator('.changes-sr-list summary');
  await expect(summary).toContainText(
    `View all changes (${eventsFixture.events.length})`,
  );

  await summary.focus();
  await summary.press('Enter');

  // Once expanded, the items inside become real visible content.
  for (const event of eventsFixture.events) {
    const display = event.title.replace(/^(?:gh|GH)-+\d+:\s*/i, '');
    await expect(
      page.locator('.changes-sr-list ul').getByText(display, { exact: false }),
    ).toBeVisible();
  }
});

test('SR-accessible list is hidden when changes toggle is off', async ({
  page,
}) => {
  await page.goto('/');
  // The <details> exists in DOM only when showEvents is true; when off,
  // the wrapping <Show> means it's not rendered.
  await expect(page.locator('.changes-sr-list')).toHaveCount(0);
});
