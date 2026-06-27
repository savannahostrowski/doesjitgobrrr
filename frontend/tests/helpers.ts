import type { Page } from '@playwright/test';
import eventsFixture from './fixtures/events.json' with { type: 'json' };
import machinesFixture from './fixtures/machines.json' with { type: 'json' };
import runsFixture from './fixtures/runs.json' with { type: 'json' };

/**
 * Install static data mocks. Must be called before any navigation so the first page load
 * already sees mocked responses.
 *
 * Note: the summary and date files both return the same fixture. DetailViewRoute
 * filters by latest-commit-per-machine client-side, so navigating to any /run/:date
 * URL renders the same data (the latest commit per machine from the fixture). Tests
 * that override `**\/data/runs/**` after calling this helper will take
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

  await page.route('**/data/machines.json', async (route) => {
    await route.fulfill({ json: machinesFixture });
  });

  await page.route('**/data/summary-*.json', async (route) => {
    await route.fulfill({ json: runsFixture });
  });

  await page.route('**/data/runs/*.json', async (route) => {
    await route.fulfill({ json: runsFixture });
  });

  await page.route('**/data/events.json', async (route) => {
    await route.fulfill({ json: eventsFixture });
  });

  await page.route('**/data/manifest.json', async (route) => {
    const dates = new Set<string>();
    for (const runs of Object.values(runsFixture.machines)) {
      for (const run of runs) {
        dates.add(run.date.split('T')[0]);
      }
    }
    await route.fulfill({
      json: {
        dates: Array.from(dates).sort(),
      },
    });
  });
}
