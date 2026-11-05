import { expect, test, Page } from '@playwright/test';
async function open(page:Page){await page.goto('/');await page.keyboard.press('Escape');}
test('session hides credentials and chat preserves context with real action confirmation',async({page})=>{
  const contexts:any[]=[];let confirmations=0;
  await page.route('**/api/v1/chat',route=>{const body=route.request().postDataJSON();contexts.push(body.history);return route.fulfill({json:body.text==='open test'?{message:'Confirm this launch',processing:'local',action:{id:'test-proposal',name:'test program',expires_in_seconds:60}}:{message:'Connected response',processing:'local',model:'test-provider'}});});
  await page.route('**/api/v1/actions/test-proposal/confirm',route=>{confirmations++;return route.fulfill({json:{message:'Launch request accepted.'}});});
  await open(page);await page.keyboard.press('c');
  await page.getByLabel('Message ORACLE').fill('First message');await page.getByRole('button',{name:/Send/}).click();
  await expect(page.getByText('Connected response',{exact:true})).toBeVisible();
  await page.getByLabel('Message ORACLE').fill('open test');await page.getByRole('button',{name:/Send/}).click();
  await expect(page.getByRole('button',{name:'Confirm launch',exact:true})).toBeVisible();expect(confirmations).toBe(0);
  expect(contexts[1]).toEqual([{role:'user',text:'First message'},{role:'model',text:'Connected response'}]);
  await page.getByRole('button',{name:'Confirm launch',exact:true}).click();await expect(page.getByText('Launch request accepted.',{exact:true})).toBeVisible();expect(confirmations).toBe(1);
  const response=await page.request.get('/api/v1/auth/session',{headers:{'X-Oracle-Client':'web'}});expect((await response.json()).token).toBeUndefined();
  const cookies=await page.context().cookies();expect(cookies.find(cookie=>cookie.name==='oracle_session')?.httpOnly).toBe(true);
});
test('notes persist across reload and failed saves keep the draft',async({page})=>{
  const title=`Integration note ${Date.now()}`;
  await open(page);await page.getByRole('button',{name:'Workspace',exact:true}).click();
  await page.getByLabel('Record title', {exact:true}).fill(title);await page.getByLabel('Record text',{exact:true}).fill('Durable integration text');
  await page.getByRole('button',{name:'Save note',exact:true}).click();await expect(page.locator('.record-row').filter({hasText:title})).toBeVisible();
  await page.reload();await page.keyboard.press('Escape');await page.getByRole('button',{name:'Workspace',exact:true}).click();
  await page.getByLabel('Search notes').fill(title);const note=page.locator('.record-row').filter({hasText:title});await expect(note).toContainText('Durable integration text');
  await note.getByRole('button',{name:'Edit note',exact:true}).click();await page.getByLabel('Record text',{exact:true}).fill('Updated text');await page.getByRole('button',{name:'Update record',exact:true}).click();await expect(note).toContainText('Updated text');
  await note.getByRole('button',{name:'Delete note',exact:true}).click();await expect(note).toHaveCount(0);
  await page.route('**/api/v1/notes',route=>route.request().method()==='POST'?route.fulfill({status:503,json:{detail:'Storage unavailable'}}):route.continue());
  await page.getByLabel('Record title',{exact:true}).fill('Unsaved');await page.getByLabel('Record text',{exact:true}).fill('Retain this draft');await page.getByRole('button',{name:'Save note',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('Storage unavailable');await expect(page.getByLabel('Record text',{exact:true})).toHaveValue('Retain this draft');
});
test('timer and reminder changes use backend records',async({page})=>{
  await open(page);await page.getByRole('button',{name:'Workspace',exact:true}).click();await page.getByRole('button',{name:'Reminders & timers',exact:true}).click();
  await page.getByLabel('Timer seconds',{exact:true}).fill('60');await page.getByRole('button',{name:'Start timer',exact:true}).click();const timer=page.locator('.record-row').filter({hasText:'Timer'});await expect(timer).toBeVisible();
  await timer.getByRole('button',{name:'Cancel task',exact:true}).click();await expect(timer).toHaveCount(0);
  const title=`Reminder ${Date.now()}`;await page.getByLabel('Reminder title',{exact:true}).fill(title);await page.getByLabel('Remind at',{exact:true}).fill('2027-12-01T10:00');await page.getByRole('button',{name:'Save reminder',exact:true}).click();
  const reminder=page.locator('.record-row').filter({hasText:title});await expect(reminder).toBeVisible();await reminder.getByRole('button',{name:'Snooze 5 minutes',exact:true}).click();await expect(page.getByRole('status')).toContainText('Saved.');await reminder.getByRole('button',{name:'Cancel task',exact:true}).click();await expect(reminder).toHaveCount(0);
});
test('closing chat cancels a late answer and skipping boot does not request sensors',async({page})=>{
  let release:(()=>void)|undefined;
  await page.addInitScript(()=>{(window as any).sensorRequests=0;Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{(window as any).sensorRequests++;throw new Error('unexpected sensor request');}});});
  await page.route('**/api/v1/chat',async route=>{await new Promise<void>(resolve=>release=resolve);await route.fulfill({json:{message:'Late answer'}}).catch(()=>{});});
  await open(page);expect(await page.evaluate(()=>(window as any).sensorRequests)).toBe(0);await page.keyboard.press('c');await page.getByLabel('Message ORACLE').fill('Wait');await page.getByRole('button',{name:/Send/}).click();
  await expect.poll(()=>Boolean(release)).toBe(true);await page.getByRole('button',{name:'Close conversation drawer',exact:true}).click();release?.();await page.keyboard.press('c');await expect(page.getByText('Late answer',{exact:true})).toHaveCount(0);
});
