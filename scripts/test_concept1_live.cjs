const { chromium } = require('../frontend/node_modules/@playwright/test');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['geolocation'],
    geolocation: { latitude: 7.1239, longitude: 79.9199 }
  });
  const page = await context.newPage();

  console.log('Navigating to http://localhost:5173...');
  await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForTimeout(2000);

  // Skip boot if needed
  await page.keyboard.press('Space');
  await page.waitForTimeout(1000);

  // Open Tactical Map via KeyN
  console.log('Opening Tactical Map...');
  await page.keyboard.press('KeyN');
  await page.waitForTimeout(1000);

  const mapContainer = page.locator('.geo-workspace-container');
  if (await mapContainer.count() === 0) {
    const directBtn = page.locator('button:has-text("Tactical Map")');
    if (await directBtn.count() > 0) {
      await directBtn.first().click();
    } else {
      const appMenu = page.locator('button:has-text("Applications")');
      if (await appMenu.count() > 0) {
        await appMenu.first().click();
        await page.waitForTimeout(400);
        await page.locator('button:has-text("Tactical Geo Map")').first().click();
      }
    }
  }

  // Wait for tiles to render
  await page.waitForTimeout(3500);

  const outDir = path.resolve(__dirname, '../output/concept1');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // 1. Capture 100% Clean Idle Map
  console.log('Capturing 1: Concept 1 Idle Map View...');
  await page.screenshot({ path: path.join(outDir, '01_concept1_idle_map.png') });

  // 2. Open Basemap Flyout Menu
  console.log('Opening Basemap flyout...');
  const basemapTrigger = page.locator('button.basemap-trigger');
  if (await basemapTrigger.count() > 0) {
    await basemapTrigger.first().click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(outDir, '02_concept1_basemap_flyout.png') });
    // Click dark or close
    await basemapTrigger.first().click();
    await page.waitForTimeout(400);
  }

  // 3. Open Contextual Drawer (click POIs button)
  console.log('Opening Contextual POI Drawer...');
  const poiBtn = page.locator('button:has-text("POIs")');
  if (await poiBtn.count() > 0) {
    await poiBtn.first().click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(outDir, '03_concept1_drawer_open.png') });
  }

  console.log('All Concept 1 screenshots captured successfully!');
  await browser.close();
})();
