import { expect, test } from '@playwright/test';

test('briefing resolves an event and hands the chosen trip to Atlas', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('oracle_session_initialized', 'true');
    localStorage.setItem('oracle_has_initialized', 'true');
  });
  const morning = new Date(new Date().setHours(9, 0, 0, 0));
  await page.clock.setFixedTime(morning);
  const eventTime = new Date(morning.getTime() + 60 * 60000).toISOString();
  await page.route('**/api/v1/auth/session', r => r.fulfill({ json: {} }));
  await page.route('**/api/v1/google/events?*', r => r.fulfill({ json: { events: [{
    id: 'today', summary: 'Campus seminar', location: 'Campus', start: { dateTime: eventTime },
  }] } }));
  await page.route('**/api/v1/tasks', r => r.fulfill({ json: { tasks: [
    { id: 'task', title: 'Pack notes', due: Date.parse(eventTime) },
  ] } }));
  await page.route('**/api/v1/geo/places', r => r.fulfill({ json: { places: [
    { name: 'Home', lat: 7.1, lon: 79.9 },
  ] } }));
  await page.route('**/api/v1/geo/search?*', r => r.fulfill({ json: { results: [
    { name: 'Campus North', display_name: 'Campus North', lat: 7.2, lon: 79.9 },
    { name: 'Campus South', display_name: 'Campus South', lat: 7.3, lon: 79.9 },
  ] } }));
  await page.route('**/api/v1/geo/route?*', r => r.fulfill({ json: {
    status: 'success', duration_seconds: 1200,
  } }));
  await page.goto('/');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Brief me', exact: true }).click();
  const briefing = page.getByRole('region', { name: 'Daily briefing' });
  await expect(briefing.getByText('Pack notes', { exact: false })).toBeVisible();
  await briefing.getByRole('button', { name: 'Campus South' }).click();
  await briefing.getByLabel('Saved start').selectOption({ label: 'Home' });
  await expect(briefing.getByText('Estimated travel is 20 min', { exact: false })).toBeVisible();
  await briefing.getByRole('button', { name: 'Open route in Atlas' }).click();
  await expect(page.getByRole('button', { name: 'Preview route', exact: true })).toBeVisible();
});
