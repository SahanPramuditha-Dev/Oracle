import { test, expect } from '@playwright/test';

test('current identity survives role changes and clears on profile deletion', async ({page}) => {
  let people = [{id:'user-a', name:'Sahan', permission:'standard', enrollment_state:'active'}];
  await page.route('**/api/v1/people', route => route.fulfill({json:{people}}));
  await page.goto('/', {waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => Boolean(window.ORACLE));
  await page.evaluate(async () => {
    window.ORACLE?.setMode('ready');
    const path = '/src/utils/currentUser.ts';
    const users = await import(path);
    users.setCurrentUser({id:'user-a', name:'Sahan', permission:'standard'});
  });
  const user = page.getByLabel('Current user', {exact:true});
  await expect(user).toHaveText('Sahan · Standard user');
  people[0].permission = 'administrator';
  await page.evaluate(() => window.dispatchEvent(new Event('oracle_profiles_changed')));
  await expect(user).toHaveText('Sahan · Administrator');
  people[0].permission = 'standard';
  await page.evaluate(() => window.dispatchEvent(new Event('oracle_profiles_changed')));
  await expect(user).toHaveText('Sahan · Standard user');
  people = [];
  await page.evaluate(() => window.dispatchEvent(new Event('oracle_profiles_changed')));
  await expect(user).toHaveText('No user identified');
});
