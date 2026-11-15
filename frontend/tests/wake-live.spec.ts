import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
test.use({launchOptions:{args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${fileURLToPath(new URL('./wake-fixture.wav', import.meta.url))}`]}});
test('real microphone detector transcribes wake phrase',async({page})=>{
  test.setTimeout(45000);
  page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')console.log(m.text().slice(0,300));});
  await page.addInitScript(()=>localStorage.setItem('oracle_speech_mode','ptt'));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.ORACLE));
  await page.evaluate(()=>window.ORACLE?.setMode('ready'));
  const transcript=page.waitForResponse(r=>r.url().includes('/voice/transcribe') && r.ok(),{timeout:30000});
  const spoken=page.waitForResponse(r=>r.url().includes('/voice/speak') && r.request().method()==='POST',{timeout:30000});
  await page.getByTitle('Toggle microphone (M)', {exact:true}).click();
  const response=await transcript;
  console.log('TRANSCRIPT',await response.text());
  await expect(page.getByLabel('Message ORACLE')).not.toBeVisible({timeout:15000});
  expect((await spoken).ok()).toBe(true);
  await expect.poll(()=>page.evaluate(()=>window.ORACLE?.getMode()),{timeout:15000}).toBe('speaking');
});
