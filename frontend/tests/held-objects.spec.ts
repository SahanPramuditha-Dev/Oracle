import { test,expect } from '@playwright/test';

test('live objects use labels and descriptions are offered only after capture',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('oracle_yolo_enabled','true');
    localStorage.setItem('oracle_show_all_objects','true');
    // A saved preference from the former description panel must not invoke it.
    localStorage.setItem('oracle_held_objects','true');
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
      const c=document.createElement('canvas');c.width=640;c.height=360;
      c.getContext('2d')!.fillRect(0,0,640,360);return c.captureStream(10);
    }});
  });
  let descriptions=0;
  await page.route('**/api/v1/people/identify*',r=>r.fulfill({json:{identified:[]}}));
  await page.route('**/api/v1/vision/detect*',r=>r.fulfill({json:{detections:[{class:'scissors',confidence:.8,box:[100,80,90,180]}]}}));
  await page.route('**/api/v1/vision/objects/identify',r=>{descriptions++;return r.fulfill({json:{description:'Unwanted live description'}});});
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.ORACLE));await page.keyboard.press('Escape');
  await page.getByTitle('Toggle optical vision feed',{exact:true}).click();
  const card=page.locator('.oracle-camera-card');
  await expect(card.locator('.camera-object-outline')).toContainText('SCISSORS');
  await expect(page.getByRole('region',{name:'Held object recognition'})).toHaveCount(0);
  await expect(page.getByRole('region',{name:'Held object recognition'})).toHaveCount(0);
  await card.getByRole('button',{name:'Capture & ask',exact:true}).click();
  await expect(card).toHaveCount(0);
  await expect(page.getByAltText('Attachment preview',{exact:true})).toBeVisible();
  await expect(page.getByRole('textbox',{name:'Message ORACLE',exact:true})).toHaveValue('Describe what you see in this snapshot.');
  expect(descriptions).toBe(0);
});
