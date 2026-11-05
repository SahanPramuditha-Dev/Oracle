import { expect, test, Page } from '@playwright/test';

async function open(page:Page){
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.ORACLE));
  await page.keyboard.press('Escape');
}

test('sleep cancels pending conversation and waking preserves existing messages',async({page})=>{
  let release:(()=>void)|undefined;
  await page.route('**/api/v1/chat',async route=>{
    if(route.request().postDataJSON().text==='Wait'){
      await new Promise<void>(resolve=>release=resolve);
      await route.fulfill({json:{message:'Stale reply'}}).catch(()=>{});
    }else await route.fulfill({json:{message:'Preserved reply',processing:'local'}});
  });
  await open(page);await page.keyboard.press('c');
  await page.getByLabel('Message ORACLE').fill('Hello');await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(page.getByText('Preserved reply',{exact:true})).toBeVisible();
  await page.getByLabel('Message ORACLE').fill('Wait');await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect.poll(()=>Boolean(release)).toBe(true);
  await page.evaluate(()=>window.ORACLE?.setMode('dormant'));
  await expect(page.getByLabel('Message ORACLE')).toHaveCount(0);
  release?.();
  await page.evaluate(()=>window.ORACLE?.setMode('ready'));
  await expect(page.getByText('Preserved reply',{exact:true})).toBeVisible();
  await expect(page.getByText('Stale reply',{exact:true})).toHaveCount(0);
});

test('camera permission denial retains file input and record access',async({page})=>{
  await page.addInitScript(()=>Object.defineProperty(navigator.mediaDevices,'getUserMedia',{
    value:async()=>{throw new DOMException('Permission denied','NotAllowedError');}
  }));
  await open(page);await page.getByTitle('Toggle optical vision feed',{exact:true}).click();
  await page.getByTitle('Toggle optical vision feed',{exact:true}).blur();
  await page.keyboard.press('c');
  await expect(page.locator('input[type=file]')).toHaveCount(1);
  await page.getByRole('button',{name:'Notes, reminders & memories',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Records workspace'})).toBeVisible();
});

test('backend failure ends waiting and a subsequent chat can recover',async({page})=>{
  let requests=0;
  await page.route('**/api/v1/chat',route=>++requests===1
    ?route.fulfill({status:503,json:{detail:'Gateway temporarily unavailable'}})
    :route.fulfill({json:{message:'Recovered reply',processing:'local'}}));
  await open(page);await page.keyboard.press('c');
  await page.getByLabel('Message ORACLE').fill('First');await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(page.getByText(/Gateway temporarily unavailable/)).toBeVisible();
  await page.getByLabel('Message ORACLE').fill('Try again');await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect(page.getByText('Recovered reply',{exact:true})).toBeVisible();
  expect(requests).toBe(2);
});
