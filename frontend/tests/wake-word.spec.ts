import { test, expect } from '@playwright/test';
test('wake detector survives mode transitions and acknowledges wake-only speech', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('oracle_speech_mode','ptt'));
  await page.route('**/src/utils/voice.ts*', route => route.fulfill({contentType:'application/javascript',body:`
    export class LocalSpeechRecorder { cancel() {} }
    export function stopSpeaking() {}
    export function readPlaybackEnergy() { return 0; }
    export function speakWithKokoro(text, callbacks) { window.spoken = text; callbacks?.onEnd?.(); }
    export async function transcribeAudioBlob() { return window.transcript || 'Hey, Oracle!'; }
    export class SileroVoiceDetector {
      constructor(callbacks) { this.callbacks=callbacks; }
      async start() { window.starts=(window.starts||0)+1; window.voiceCallbacks=this.callbacks; }
      async destroy() { window.destroys=(window.destroys||0)+1; }
      isActive() { return true; }
      async pause() {} async resume() {}
    }
  `}));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => Boolean(window.ORACLE));
  await page.evaluate(() => window.ORACLE?.setMode('ready'));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('oracle_open_settings', {detail:'voice'})));
  await page.getByRole('button', {name:'Wake Word ("Hey Oracle")', exact:true}).click();
  await page.getByRole('button', {name:'Close Preferences'}).click();
  await page.waitForFunction(() => Boolean((window as any).voiceCallbacks));
  const starts = await page.evaluate(() => (window as any).starts);
  await page.evaluate(() => (window as any).voiceCallbacks.onSpeechStart());
  await expect.poll(() => page.evaluate(() => window.ORACLE?.getMode())).toBe('listening');
  expect(await page.evaluate(() => (window as any).starts)).toBe(starts);
  await page.evaluate(() => (window as any).voiceCallbacks.onSpeechEnd(new Blob(['audio'])));
  await expect(page.getByLabel('Message ORACLE')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).spoken)).toContain("I'm listening");
  expect(await page.evaluate(() => (window as any).starts)).toBe(starts);
});

test('an inactive microphone cannot display a stale listening status', async ({page}) => {
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => Boolean(window.ORACLE));
  await page.evaluate(() => window.ORACLE?.setMode('listening'));
  await expect(page.locator('#status-label')).toHaveText('READY');
  await expect(page.getByRole('button', {name:'Microphone: Microphone off'})).toBeVisible();
});




test('header microphone records and stops without opening the chat drawer', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('oracle_speech_mode','ptt'));
  await page.route('**/src/utils/voice.ts*', route => route.fulfill({contentType:'application/javascript',body:`
    export class LocalSpeechRecorder {
      cancel() {}
      async start() { window.recording=true; return true; }
      async stopAndTranscribe() { window.recording=false; return ''; }
    }
    export function stopSpeaking() {}
    export function readPlaybackEnergy() { return 0; }
    export function speakWithKokoro() {}
    export async function transcribeAudioBlob() { return ''; }
    export class SileroVoiceDetector { async destroy() {} }
  `}));
  await page.goto('/', {waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => Boolean(window.ORACLE));
  await page.evaluate(() => window.ORACLE?.setMode('ready'));
  await page.getByRole('button', {name:'Microphone: Microphone off'}).click();
  await expect.poll(() => page.evaluate(() => (window as any).recording)).toBe(true);
  await expect(page.getByLabel('Message ORACLE')).not.toBeVisible();
  await page.getByRole('button', {name:'Microphone: Recording (Push-to-Talk)'}).click();
  await expect.poll(() => page.evaluate(() => (window as any).recording)).toBe(false);
  await expect(page.getByLabel('Message ORACLE')).not.toBeVisible();
  await expect(page.locator('#status-label')).toHaveText('READY');
  await page.getByRole('button', {name:'Microphone: Microphone off'}).blur();
  await page.keyboard.press('m');
  await expect.poll(() => page.evaluate(() => (window as any).recording)).toBe(true);
  await expect(page.getByLabel('Message ORACLE')).not.toBeVisible();
});
