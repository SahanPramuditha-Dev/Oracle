import { test, expect } from '@playwright/test';

test('foreground selection follows stable IDs and clears on subject loss', async ({page}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {value: async () => {
      const c = document.createElement('canvas'); c.width=640; c.height=360;
      c.getContext('2d')!.fillRect(0,0,640,360); return c.captureStream(10);
    }});
  });
  let lost = false;
  await page.route('**/api/v1/people/identify', r => r.fulfill({json:{identified:[]}}));
  await page.route('**/api/v1/vision/detect*', async r => {
    const mask = await page.evaluate(() => {const c=document.createElement('canvas'); c.width=20;c.height=20;const x=c.getContext('2d')!;x.fillStyle='white';x.fillRect(0,0,20,20);return c.toDataURL();});
    await r.fulfill({json:{detections:lost?[]:[{class:'person',confidence:.9,box:[100,50,150,250],mask}]}});
  });
  await page.route('**/api/v1/vision/objects/identify',r=>r.fulfill({json:{description:'No held object visible',is_estimate:true}}));
  await page.goto('/', {waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => Boolean(window.ORACLE)); await page.keyboard.press('Escape');
  await page.getByTitle('Toggle optical vision feed',{exact:true}).click();
  await page.getByRole('combobox',{name:'Foreground',exact:true}).selectOption('selected');
  await expect(page.getByRole('combobox',{name:'Subject',exact:true}).locator('option')).toHaveCount(2,{timeout:10000});
  await page.getByRole('combobox',{name:'Subject',exact:true}).selectOption('1');
  await expect(page.getByRole('status').filter({hasText:'Foreground isolated'})).toBeVisible();
  await expect(page.getByRole('combobox',{name:'Subject',exact:true})).toHaveValue('1');
  const alpha = (x:number,y:number) => page.locator('.camera-viewport-frame canvas').evaluate((c,point) => (c as HTMLCanvasElement).getContext('2d')!.getImageData(point[0],point[1],1,1).data[3],[x,y]);
  await expect.poll(() => alpha(150,100)).toBe(0);
  await expect.poll(() => alpha(10,10)).toBeGreaterThan(150);
  await page.locator('.oracle-camera-card').screenshot({path:'../data/foreground-preview.png'});
  lost=true;
  await expect(page.getByRole('status').filter({hasText:'Waiting for subject'})).toBeVisible({timeout:10000});
  await expect.poll(() => alpha(10,10)).toBe(0);
});
