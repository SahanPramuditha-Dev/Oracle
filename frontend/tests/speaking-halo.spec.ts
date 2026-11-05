import { test, expect } from '@playwright/test';
test('speaking halo follows playback and resets on stop', async ({page}) => {
  await page.addInitScript(() => {
    localStorage.setItem('oracle_speech_mode','ptt');
    (window as any).Audio = class {
      paused=true; src=''; onplay:any; onended:any; onerror:any;
      async play() {this.paused=false; this.onplay?.();}
      pause(){this.paused=true;}
    };
    (window as any).AudioContext = class {
      destination={};
      createAnalyser(){return {fftSize:256, getByteTimeDomainData(data:Uint8Array){data.fill((window as any).silent ? 128 : 160);}, disconnect(){}};}
      createMediaElementSource(){return {connect(){},disconnect(){}};}
      async resume(){}
    };
  });
  await page.route('**/api/v1/voice/speak', route=>route.fulfill({contentType:'audio/wav',body:'fixture'}));
  await page.goto('/',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(window.ORACLE));
  await page.evaluate(() => window.ORACLE?.setMode('ready'));
  await page.waitForTimeout(500);
  await page.evaluate(async()=>{
    const path='/src/utils/voice.ts', voice=await import(path);
    await voice.speakWithKokoro('Speaking preview',{onStart:()=>window.ORACLE?.setMode('speaking')});
    (window as any).energy=voice.readPlaybackEnergy();
  });
  expect(await page.evaluate(()=>(window as any).energy)).toBeGreaterThan(0);
  await page.waitForTimeout(1800);
  await page.screenshot({path:'test-results/speaking-desktop.png'});
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'test-results/speaking-mobile.png'});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.screenshot({path:'test-results/speaking-reduced.png'});
  await page.evaluate(async()=>{
    const path='/src/utils/voice.ts', voice=await import(path);
    (window as any).silent=true;
    (window as any).silentEnergy=voice.readPlaybackEnergy();
    voice.stopSpeaking();
    (window as any).stoppedEnergy=voice.readPlaybackEnergy();
  });
  expect(await page.evaluate(()=>(window as any).silentEnergy)).toBe(0);
  expect(await page.evaluate(()=>(window as any).stoppedEnergy)).toBe(0);
});
