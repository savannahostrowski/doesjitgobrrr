import type { Page } from '@playwright/test';
import runsFixture from './fixtures/runs.json' with { type: 'json' };
import machinesFixture from './fixtures/machines.json' with { type: 'json' };

/**
 * Install API mocks. Must be called before any navigation so the first page load
 * already sees mocked responses.
 *
 * Note: the summary and date endpoints both return the same fixture. DetailViewRoute
 * filters by latest-commit-per-machine client-side, so navigating to any /run/:date
 * URL renders the same data (the latest commit per machine from the fixture). Tests
 * that override `**\/api/historical/date/**` after calling this helper will take
 * precedence.
 */
export async function mockApi(page: Page): Promise<void> {
  // Prevent localStorage caches from leaking data between tests
  await page.addInitScript(() => {
    try {
      globalThis.localStorage.clear();
    } catch {
      // ignore
    }
  });

  await page.route('**/api/machines', async (route) => {
    await route.fulfill({ json: machinesFixture });
  });

  await page.route('**/api/historical/summary**', async (route) => {
    await route.fulfill({ json: runsFixture });
  });

  await page.route('**/api/historical/date/**', async (route) => {
    await route.fulfill({ json: runsFixture });
  });
}
