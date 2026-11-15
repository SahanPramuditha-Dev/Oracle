import {test,expect} from '@playwright/test';
import {fileURLToPath} from 'node:url';
test.use({launchOptions:{args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream',`--use-file-for-fake-audio-capture=${fileURLToPath(new URL('./live-caption-fixture.wav',import.meta.url))}`]}});
test('real audio updates caption before speech ends',async({page})=>{
 test.setTimeout(60000);
 await page.addInitScript(()=>localStorage.setItem('oracle_speech_mode','ptt'));
 await page.goto('/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>Boolean(window.ORACLE));
 await page.evaluate(()=>window.ORACLE?.setMode('ready'));
 page.on('response',async r=>{if(r.url().includes('voice/transcribe'))console.log('TRANSCRIPT',r.status(),await r.text().catch(()=>''));});
 await page.evaluate(()=>window.dispatchEvent(new CustomEvent('oracle_speech_mode_changed',{detail:'vad'})));
 await expect(page.locator('.user-speech-caption')).toHaveAttribute('data-state','listening',{timeout:15000});
 await expect(page.locator('.user-speech-caption p')).toContainText(/oracle/i,{timeout:30000});
 await expect(page.locator('.user-speech-caption p')).not.toContainText(/Listening|Transcribing/);
 await expect(page.locator('.user-speech-caption')).toHaveAttribute('data-state','listening');
 await page.screenshot({path:'test-results/real-live-captions.png'});
});
test('manual recorder returns partial text while still recording',async({page})=>{
 test.setTimeout(45000);
 await page.addInitScript(()=>localStorage.setItem('oracle_speech_mode','ptt'));
 await page.goto('/',{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>Boolean(window.ORACLE));
 await page.evaluate(async()=>{
  window.ORACLE?.setMode('ready');
  const path='/src/utils/voice.ts';
  const {LocalSpeechRecorder}=await import(path);
  (window as any).captionRecorder=new LocalSpeechRecorder();
  await (window as any).captionRecorder.start((text:string)=>{(window as any).manualPartial=text;});
 });
 await expect.poll(()=>page.evaluate(()=>(window as any).manualPartial||''),{timeout:30000}).not.toBe('');
 await page.evaluate(()=>(window as any).captionRecorder.cancel());
});
