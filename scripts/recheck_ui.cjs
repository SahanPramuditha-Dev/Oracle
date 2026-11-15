const { chromium } = require('../frontend/node_modules/@playwright/test');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['geolocation'],
    geolocation: { latitude: 6.9271, longitude: 79.8612 }
  });
  const page = await context.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('PAGE ERROR:', msg.text());
  });

  console.log('Navigating to http://127.0.0.1:5173...');
  try {
    await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch {
    await page.goto('http://127.0.0.1:5173', { timeout: 10000 });
  }
  await page.waitForTimeout(2000);

  // Wake Oracle by clicking .hint-capsule
  const hintCapsule = page.locator('.hint-capsule');
  if (await hintCapsule.count() > 0) {
    await hintCapsule.first().click();
    await page.waitForTimeout(1500);
  } else {
    await page.click('#scene');
    await page.waitForTimeout(1500);
  }

  // Press KeyN to toggle Tactical Map
  await page.keyboard.press('KeyN');
  await page.waitForTimeout(3500);

  // State 1: Standby Map
  await page.screenshot({ path: path.join(__dirname, '../output/recheck2_standby.png') });
  console.log('Captured output/recheck2_standby.png');

  // State 2: Open Panel Drawer
  const panelBtn = page.locator('.geo-capsule-btn:has-text("Panel")');
  if (await panelBtn.count() > 0) {
    await panelBtn.first().click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(__dirname, '../output/recheck2_drawer.png') });
    console.log('Captured output/recheck2_drawer.png');
    // Close panel
    await panelBtn.first().click();
    await page.waitForTimeout(400);
  }

  // State 3: Open Basemap Menu
  const basemapBtn = page.locator('.basemap-trigger');
  if (await basemapBtn.count() > 0) {
    await basemapBtn.first().click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(__dirname, '../output/recheck2_basemap.png') });
    console.log('Captured output/recheck2_basemap.png');
  }

  await browser.close();
  console.log('All screenshots captured successfully.');
})().catch(err => {
  console.error('Test run failed:', err);
  process.exit(1);
});
