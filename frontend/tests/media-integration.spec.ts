import { test, expect, Page } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
const label=resolve('../data/readiness/reading-fixtures/label-qr.png');
const audio=resolve('../data/readiness/voice-fixtures/open-notepad.wav');
test.beforeAll(()=>{for(const [file,script] of [[label,'prepare_reading_fixture.py'],[audio,'prepare_voice_fixture.py']])if(!existsSync(file))execFileSync(resolve('../backend/.venv/Scripts/python.exe'),[resolve('../scripts',script)]);});
async function ready(page:Page){await page.waitForFunction(()=>Boolean(window.ORACLE));await page.keyboard.press('Escape');}
async function open(page:Page){await page.goto('/',{waitUntil:'domcontentloaded'});await ready(page);}
test('real OCR and saved image memory persist, edit, and delete through the redesigned workspace',async({page})=>{
  test.setTimeout(90000);
  const title=`Image integration ${Date.now()}`;
  await open(page);await page.keyboard.press('c');await page.locator('input[type=file]').setInputFiles(label);
  await page.getByRole('button',{name:'Read text & QR',exact:true}).click();
  await expect(page.getByLabel('Image description / corrected text',{exact:true})).toHaveValue(/A12345/,{timeout:30000});
  await expect(page.locator('.qr-preview')).toContainText('https://example.com/oracle-test');await expect(page.locator('.qr-preview a')).toHaveCount(0);
  await page.getByLabel('Image title',{exact:true}).fill(title);await page.getByLabel('Image description / corrected text',{exact:true}).fill('Corrected image integration');
  const savedResponse=page.waitForResponse(r=>r.url().endsWith('/api/v1/memories')&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Save image memory',exact:true}).click();const saved=await(await savedResponse).json();
  await expect(page.getByText('Image memory saved in backend.',{exact:true})).toBeVisible();
  await page.reload({waitUntil:'domcontentloaded'});await ready(page);await page.getByRole('button',{name:'Workspace',exact:true}).click();await page.getByRole('button',{name:'Memories',exact:true}).click();await page.getByLabel('Search memories').fill(title);
  const row=page.locator('.record-row').filter({hasText:title});await expect(row).toContainText('Corrected image integration');await row.getByRole('button',{name:'View image',exact:true}).click();await expect(page.getByAltText('Saved image memory')).toBeVisible();
  await row.getByRole('button',{name:'Edit memory',exact:true}).click();await page.getByLabel('Record text',{exact:true}).fill('Edited image description');await page.getByRole('button',{name:'Update record',exact:true}).click();await expect(row).toContainText('Edited image description');
  await row.getByRole('button',{name:'Delete memory',exact:true}).click();await expect(row).toHaveCount(0);
  expect((await page.request.get(`/api/v1/memories/${saved.id}/image`,{headers:{'X-Oracle-Client':'web'}})).status()).toBe(404);
});
test('PTT uses backend transcription and leaves a reviewable draft',async({page})=>{
  test.setTimeout(90000);
  const base64=readFileSync(audio).toString('base64');let chatCalls=0;
  await page.addInitScript(base64=>{
    const bytes=Uint8Array.from(atob(base64),c=>c.charCodeAt(0));Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>new MediaStream()});
    class Recorder{static isTypeSupported(){return false;}state='inactive';mimeType='audio/wav';ondataavailable:any;onstop:any;start(){this.state='recording';}stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob([bytes],{type:this.mimeType})});this.onstop?.();});}}
    Object.defineProperty(window,'MediaRecorder',{value:Recorder});
  },base64);
  page.on('request',r=>{if(r.url().endsWith('/api/v1/chat'))chatCalls++;});
  await open(page);await page.keyboard.press('c');await page.getByTitle('Push-to-talk (Faster-Whisper)',{exact:true}).click();await page.getByTitle('Click to stop & transcribe',{exact:true}).click({force:true});
  await expect(page.getByLabel('Message ORACLE')).toHaveValue(/open note\s?pad\.?/i,{timeout:30000});expect(chatCalls).toBe(0);
});
test('stopped speech cannot play after its request completes',async({page})=>{
  let release:(()=>void)|undefined;
  await page.addInitScript(()=>{(window as any).played=0;HTMLMediaElement.prototype.play=function(){(window as any).played++;return Promise.resolve();};});
  await page.route('**/api/v1/chat',route=>route.fulfill({json:{message:'Actual integration reply',processing:'local'}}));
  await page.route('**/api/v1/voice/speak',async route=>{await new Promise<void>(resolve=>release=resolve);await route.fulfill({contentType:'audio/wav',body:readFileSync(audio)}).catch(()=>{});});
  await open(page);await page.keyboard.press('c');await page.getByTitle('Enable natural speech',{exact:true}).click();await page.getByLabel('Message ORACLE').fill('Hello');await page.getByRole('button',{name:'Send message',exact:true}).click();
  await expect.poll(()=>Boolean(release)).toBe(true);await page.getByRole('button',{name:'Stop response / audio',exact:true}).click();release?.();expect(await page.evaluate(()=>(window as any).played)).toBe(0);
});
test('camera captures a synthetic frame and releases its tracks on capture',async({page})=>{
  await page.addInitScript(()=>{(window as any).cameraStopped=false;Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;canvas.getContext('2d')!.fillRect(0,0,640,480);const stream=canvas.captureStream(10);const track=stream.getVideoTracks()[0];const stop=track.stop.bind(track);track.stop=()=>{(window as any).cameraStopped=true;stop();};return stream;}});});
  await page.route('**/api/v1/vision/detect',r=>r.fulfill({json:{detections:[]}}));await page.route('**/api/v1/people/identify',r=>r.fulfill({json:{identified:[]}}));
  await open(page);await page.getByTitle('Toggle optical vision feed',{exact:true}).click();await expect(page.getByTitle('Snapshot and Ask Moondream',{exact:true})).toBeEnabled();await page.getByTitle('Snapshot and Ask Moondream',{exact:true}).click();
  await expect(page.getByRole('region',{name:'Image reader',exact:true})).toBeVisible();expect(await page.evaluate(()=>(window as any).cameraStopped)).toBe(true);
});
