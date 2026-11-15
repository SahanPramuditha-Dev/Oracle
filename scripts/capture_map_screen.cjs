const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    permissions: ['geolocation'],
    geolocation: { latitude: 7.1239, longitude: 79.9199 }
  });
  const page = await context.newPage();
  
  console.log('Navigating to http://localhost:5173...');
  await page.goto('http://localhost:5173', { waitUntil: 'networkidle' });
  
  // Wait a moment for boot
  await page.waitForTimeout(2000);
  
  // Press KeyN or click Tactical Map
  console.log('Opening Tactical Map with KeyN...');
  await page.keyboard.press('KeyN');
  
  // Wait for map container and tiles
  await page.waitForTimeout(4000);
  
  // Take screenshot
  const outPath = '../output/current_map_live.png';
  await page.screenshot({ path: outPath });
  console.log('Saved screenshot to ' + outPath);
  
  await browser.close();
})();
