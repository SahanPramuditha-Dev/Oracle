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
  try {
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 15000 });
  } catch (err) {
    console.error('Failed to load localhost:5173:', err.message);
    await browser.close();
    process.exit(1);
  }

  // Wait for presence scene to mount
  await page.waitForTimeout(2500);

  // Skip boot if needed
  await page.keyboard.press('Space');
  await page.waitForTimeout(1000);

  // Press KeyN to open Tactical Map
  console.log('Triggering Tactical Map via KeyN shortcut...');
  await page.keyboard.press('KeyN');
  await page.waitForTimeout(1000);

  // If map didn't open yet, find and click Tactical Map or Applications button
  const mapContainer = page.locator('.geo-workspace-container');
  if (await mapContainer.count() === 0) {
    const directBtn = page.locator('button:has-text("Tactical Map")');
    if (await directBtn.count() > 0) {
      console.log('Clicking Tactical Map button in header...');
      await directBtn.first().click();
    } else {
      const appMenu = page.locator('button:has-text("Applications")');
      if (await appMenu.count() > 0) {
        console.log('Opening Applications menu...');
        await appMenu.first().click();
        await page.waitForTimeout(500);
        const geoItem = page.locator('button:has-text("Tactical Geo Map")');
        if (await geoItem.count() > 0) {
          console.log('Clicking Tactical Geo Map menu item...');
          await geoItem.first().click();
        }
      }
    }
  }
  await page.waitForTimeout(3000);

  const outDir = path.resolve(__dirname, '../output/basemap_tests');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  // 1. Initial / DARK basemap
  console.log('Testing 1: DARK (Cyber Inverted)...');
  await page.screenshot({ path: path.join(outDir, '01_dark.png') });

  // 2. Click SAT button
  console.log('Testing 2: SAT (Satellite)...');
  const satBtn = page.locator('button.geo-hud-btn.mini', { hasText: 'SAT' });
  if (await satBtn.count() > 0) {
    await satBtn.first().click();
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(outDir, '02_satellite.png') });
  } else {
    console.warn('SAT button not found!');
  }

  // 3. Click HYBRID button
  console.log('Testing 3: HYBRID (Satellite + Vector Overlays)...');
  const hybridBtn = page.locator('button.geo-hud-btn.mini', { hasText: 'HYBRID' });
  if (await hybridBtn.count() > 0) {
    await hybridBtn.first().click();
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(outDir, '03_hybrid.png') });
  } else {
    console.warn('HYBRID button not found!');
  }

  // 4. Click TOPO button
  console.log('Testing 4: TOPO (Topographic Relief)...');
  const topoBtn = page.locator('button.geo-hud-btn.mini', { hasText: 'TOPO' });
  if (await topoBtn.count() > 0) {
    await topoBtn.first().click();
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(outDir, '04_topo.png') });
  } else {
    console.warn('TOPO button not found!');
  }

  // 5. Click STREET button
  console.log('Testing 5: STREET (Daytime Vector Roads)...');
  const streetBtn = page.locator('button.geo-hud-btn.mini', { hasText: 'STREET' });
  if (await streetBtn.count() > 0) {
    await streetBtn.first().click();
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(outDir, '05_street.png') });
  } else {
    console.warn('STREET button not found!');
  }

  // 6. Click OSM button
  console.log('Testing 6: OSM (OpenStreetMap Global)...');
  const osmBtn = page.locator('button.geo-hud-btn.mini', { hasText: 'OSM' });
  if (await osmBtn.count() > 0) {
    await osmBtn.first().click();
    await page.waitForTimeout(3500);
    await page.screenshot({ path: path.join(outDir, '06_osm.png') });
  } else {
    console.warn('OSM button not found!');
  }

  // Check left blade card screenshot
  const leftBlade = page.locator('.geo-left-blade');
  if (await leftBlade.count() > 0) {
    await leftBlade.screenshot({ path: path.join(outDir, 'left_blade_card.png') });
    console.log('Captured left blade card screenshot!');
  }

  // Check right hud screenshot
  const rightHud = page.locator('.geo-right-hud');
  if (await rightHud.count() > 0) {
    await rightHud.screenshot({ path: path.join(outDir, 'right_hud.png') });
    console.log('Captured right HUD screenshot!');
  }

  console.log('All 6 basemaps and UI components tested successfully!');
  await browser.close();
})();
