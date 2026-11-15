import { expect, test } from '@playwright/test';

test('Atlas preserves a pin when changing basemap and lets the panel close', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/api/v1/auth/session', route => route.fulfill({ json: {} }));
  await page.route('**/api/v1/geo/reverse?**', route => route.fulfill({ json: { name: 'Atlas test pin' } }));
  await page.route('**/api/v1/geo/providers?**', route => route.fulfill({
    json: { providers: { walking: 'not_configured', cycling: 'not_configured', driving: 'configured' } }
  }));
  await page.goto('/');
  await page.mouse.click(720, 320);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('oracle_atlas_command', { detail: 'what is nearby' })));

  const canvas = page.locator('.maplibregl-canvas');
  await expect(canvas).toBeVisible();
  await expect(page.getByRole('button', { name: 'Walking route' })).toBeDisabled();
  await canvas.click({ position: { x: 950, y: 420 } });
  const marker = page.locator('.geo-pin-hud-name');
  await expect(marker).toHaveText('Atlas test pin');

  await page.getByRole('button', { name: 'Minimize Atlas panel' }).click();
  await expect(page.locator('#atlas-panel')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Panel', exact: true })).toBeFocused();

  await page.getByRole('button', { name: 'Basemap: Dark' }).click();
  await page.getByRole('button', { name: /^Street\b/ }).click();
  await expect(marker).toHaveText('Atlas test pin');
  await expect(page.locator('#atlas-panel')).toBeHidden();
});

test('Atlas resumes guidance and retries a failed reroute through unvisited stops in order', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    const watches = new Map<number, PositionCallback>();
    let nextId = 0;
    navigator.geolocation.watchPosition = callback => {
      watches.set(++nextId, callback);
      return nextId;
    };
    navigator.geolocation.clearWatch = id => { watches.delete(id); };
    window.addEventListener('atlas-test-fix', event => {
      const { longitude, latitude, accuracy } = (event as CustomEvent).detail;
      const fix = { coords: { longitude, latitude, accuracy, heading: null, speed: null }, timestamp: Date.now() };
      for (const callback of watches.values()) callback(fix as GeolocationPosition);
    });
  });
  const fix = (longitude: number, latitude = 6.9, accuracy = 10) => page.evaluate(
    detail => window.dispatchEvent(new CustomEvent('atlas-test-fix', { detail })), { longitude, latitude, accuracy }
  );

  await page.route('**/api/v1/auth/session', route => route.fulfill({ json: {} }));
  await page.route('**/api/v1/geo/search?**', route => {
    const name = new URL(route.request().url()).searchParams.get('q')!;
    const lon = { First: 79.91, Second: 79.92, Third: 79.93, Destination: 79.94 }[name];
    return route.fulfill({ json: { results: [{ name, lon, lat: 6.9, display_name: name }] } });
  });
  const requests: string[][] = [];
  await page.route('**/api/v1/geo/route?**', route => {
    const params = new URL(route.request().url()).searchParams;
    const stops = params.getAll('stop');
    requests.push(stops);
    if (requests.length === 2) {
      return route.fulfill({ json: { status: 'unavailable' } });
    }
    return route.fulfill({ json: {
      status: 'success',
      geometry: { type: 'LineString', coordinates: [
        [Number(params.get('start_lon')), Number(params.get('start_lat'))],
        ...stops.map(stop => stop.split(',').map(Number)), [79.94, 6.9]
      ] },
      duration_seconds: 600, distance_meters: 4500, legs: []
    } });
  });

  await page.goto('/');
  await page.mouse.click(720, 320);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('oracle_atlas_command', { detail: 'what is nearby' })));
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await fix(79.90);
  const search = page.getByRole('textbox', { name: 'Search places' });
  for (const name of ['First', 'Second', 'Third', 'Destination']) {
    await search.fill(name);
    await search.press('Enter');
    const card = page.locator('.atlas-place-card').filter({ hasText: name });
    if (name === 'Destination') {
      await card.getByRole('button', { name: 'Directions', exact: true }).click();
    } else {
      await card.getByText('More actions', { exact: true }).click();
      await card.getByRole('button', { name: 'Add stop', exact: true }).click();
    }
  }
  await fix(79.90);
  await page.getByRole('button', { name: 'Start Navigation' }).click();
  await fix(79.90, 6.9, 120);
  await expect(page.getByText(/GPS signal weak/).first()).toBeVisible();
  await fix(79.915);
  await expect(page.getByText(/km remaining/).first()).toBeVisible();
  await fix(79.916, 6.902);
  await fix(79.917, 6.902);
  await fix(79.918, 6.902);
  await expect(page.getByText('Rerouting failed. Atlas will retry if you stay off route.', { exact: true })).toBeVisible();
  await fix(79.918, 6.902);
  await fix(79.919, 6.902);
  await fix(79.920, 6.902);
  expect(requests).toHaveLength(2);

  const now = await page.evaluate(() => Date.now());
  await page.clock.setFixedTime(now + 31_000);
  await fix(79.918, 6.902);
  await fix(79.919, 6.902);
  await fix(79.920, 6.902);
  await expect.poll(() => requests).toEqual([
    ['79.91,6.9', '79.92,6.9', '79.93,6.9'],
    ['79.92,6.9', '79.93,6.9'],
    ['79.92,6.9', '79.93,6.9']
  ]);
  await expect(page.getByText('From Device location', { exact: true })).toBeVisible();
  await fix(79.92);
  await fix(79.93);
  await fix(79.94);
  await expect(page.getByText('Arrived at your destination.', { exact: true })).toBeVisible();
});
