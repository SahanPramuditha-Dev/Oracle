import { test, expect } from '@playwright/test';
test('wake detector survives mode transitions and acknowledges wake-only speech', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('oracle_speech_mode','ptt'));
  await page.route('**/src/utils/voice.ts*', route => route.fulfill({contentType:'application/javascript',body:`
    export class LocalSpeechRecorder { cancel() {} }
    export function stopSpeaking() {}
    export function readPlaybackEnergy() { return 0; }
    export function getSpeechSpeed() { return 1; }; export function isNoiseReductionEnabled() { return false; }
    export function isSpeakingActive() { return false; }
    export function isBargeInEnabled() { return true; }
    export function isLocalFastPathEnabled() { return true; }
    export function isBargeInAllowed() { return true; }
    export function unlockAudio() { return Promise.resolve(true); }
    export function speakWithKokoro(text, callbacks) { window.spoken = text; callbacks?.onEnd?.(); }
    export async function transcribeAudioBlob(blob, signal, wake, interim) {
      if (interim && window.deferPartial) {
        window.partialSignal = signal;
        return new Promise(resolve => window.resolvePartial = resolve);
      }
      if (!interim && window.deferFinal) {
        window.finalSignal = signal;
        return new Promise(resolve => window.resolveFinal = resolve);
      }
      return window.transcript || 'Hey, Oracle!';
    }
    export class SileroVoiceDetector {
      constructor(callbacks) { this.callbacks=callbacks; }
      async start() { window.starts=(window.starts||0)+1; window.voiceCallbacks=this.callbacks; return true; }
      async destroy() { window.destroys=(window.destroys||0)+1; }
      isActive() { return true; }
      async pause() {} async resume() {}
    }
  `}));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => Boolean(window.ORACLE));
  const skipIntro = page.getByRole('button', {name:'Skip intro'});
  if (await skipIntro.isVisible()) await skipIntro.click();
  await page.evaluate(() => window.ORACLE?.setMode('ready'));
  expect(await page.evaluate(() => localStorage.getItem('oracle_speech_mode'))).toBe('ptt');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('oracle_open_settings', {detail:'voice'})));
  await page.getByRole('button', {name:'Wake Word ("Hey Oracle")', exact:true}).click();
  await page.getByRole('button', {name:'Close Preferences'}).click();
  await page.waitForFunction(() => Boolean((window as any).voiceCallbacks));
  const starts = await page.evaluate(() => (window as any).starts);
  await page.evaluate(async () => {
    const app = window as any;
    app.transcript = 'We use Oracle at work';
    app.voiceCallbacks.onSpeechStart();
    await app.voiceCallbacks.onSpeechEnd(new Blob(['audio']));
  });
  await expect.poll(() => page.evaluate(() => (window as any).spoken)).toBeUndefined();
  await expect(page.getByLabel('Message ORACLE')).not.toBeVisible();

  await page.evaluate(() => (window as any).voiceCallbacks.onSpeechStart());
  await expect.poll(() => page.evaluate(() => window.ORACLE?.getMode())).toBe('listening');
  await expect(page.locator('.user-speech-caption')).toHaveAttribute('data-state', 'listening');
  expect(await page.evaluate(() => (window as any).starts)).toBe(starts);
  await page.evaluate(async () => {
    (window as any).transcript='Hey Oracle, what is';
    await (window as any).voiceCallbacks.onSpeechProgress(new Blob(['partial audio']));
  });
  await expect(page.locator('.user-speech-caption')).toContainText('Hey Oracle, what is');
  await expect.poll(() => page.evaluate(() => window.ORACLE?.getMode())).toBe('listening');
  await expect(page.getByLabel('Message ORACLE')).not.toBeVisible();
  await page.evaluate(() => {
    (window as any).transcript='Hey, Oracle!';
    (window as any).deferPartial=true;
    void (window as any).voiceCallbacks.onSpeechProgress(new Blob(['delayed partial']));
  });

  await page.evaluate(() => (window as any).voiceCallbacks.onSpeechEnd(new Blob(['audio'])));
  await expect(page.getByLabel('Message ORACLE')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).spoken)).toContain("I'm listening");
  expect(await page.evaluate(() => (window as any).partialSignal.aborted)).toBe(true);
  await page.evaluate(() => (window as any).resolvePartial('Stale partial text'));
  expect(await page.evaluate(() => (window as any).starts)).toBe(starts);

  await page.evaluate(() => {
    const app = window as any;
    app.deferFinal = true;
    app.mapDispatches = 0;
    window.addEventListener('oracle_activate_atlas_protocol', () => app.mapDispatches++);
    app.voiceCallbacks.onSpeechStart();
    app.finalWork = app.voiceCallbacks.onSpeechEnd(new Blob(['audio']));
  });
  await page.waitForFunction(() => Boolean((window as any).resolveFinal));
  await page.getByRole('button', {name:'Stop', exact:true}).click();
  expect(await page.evaluate(() => (window as any).finalSignal.aborted)).toBe(true);
  const dispatches = await page.evaluate(async () => {
    const app = window as any;
    app.resolveFinal('Hey Oracle, open map');
    await app.finalWork;
    return app.mapDispatches;
  });
  expect(dispatches).toBe(0);
});

test('an inactive microphone cannot display a stale listening status', async ({page}) => {
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => Boolean(window.ORACLE));
  await page.evaluate(() => window.ORACLE?.setMode('listening'));
  await expect(page.locator('#status-label')).toHaveText('READY');
  await expect(page.getByTitle('Toggle microphone (M)', {exact:true})).toHaveAttribute('aria-pressed', 'false');
});




test('push-to-talk shows recognized words while recording', async ({page}) => {
  await page.addInitScript(() => localStorage.setItem('oracle_speech_mode','ptt'));
  await page.route('**/src/utils/voice.ts*', route => route.fulfill({contentType:'application/javascript',body:`
    export class LocalSpeechRecorder {
      cancel() {}
      async start(onPartial) { window.recording=true; window.emitPartial=onPartial; return true; }
      async stopAndTranscribe() { window.recording=false; return ''; }
    }
    export function stopSpeaking() {}
    export function readPlaybackEnergy() { return 0; }
    export function getSpeechSpeed() { return 1; }; export function isNoiseReductionEnabled() { return false; }
    export function isSpeakingActive() { return false; }
    export function isBargeInEnabled() { return true; }
    export function isLocalFastPathEnabled() { return true; }
    export function isBargeInAllowed() { return true; }
    export function unlockAudio() { return Promise.resolve(true); }
    export function speakWithKokoro() {}
    export async function transcribeAudioBlob() { return ''; }
    export class SileroVoiceDetector { constructor(callbacks) {} async start() { window.detectorActive=true; } async destroy() { window.detectorActive=false; } isActive() { return true; } async pause() {} async resume() {} }
  `}));
  await page.goto('/', {waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => Boolean(window.ORACLE));
  await page.evaluate(() => window.ORACLE?.setMode('ready'));
  await page.getByTitle('Toggle microphone (M)', {exact:true}).click();
  await expect.poll(() => page.evaluate(() => (window as any).recording)).toBe(true);
  await expect(page.locator('.user-speech-caption')).not.toContainText(/Listening|Transcribing/);
  await page.evaluate(() => (window as any).emitPartial('A live caption'));
  await expect(page.locator('.user-speech-caption p')).toHaveText('A live caption');
  await expect(page.getByLabel('Message ORACLE')).not.toBeVisible();
});
