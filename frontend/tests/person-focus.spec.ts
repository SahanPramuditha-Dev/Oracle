import { test, expect } from '@playwright/test';
import { combineSubjects, choosePrimary, type CameraDetection } from '../src/utils/personFocus';
import type { FaceObservation } from '../src/utils/faceTracking';
const body:CameraDetection={class:'person',confidence:.9,trackId:1,box:[100,20,180,320]};
const face:FaceObservation={id:'alice',name:'Alice',matched:true,recognition_state:'recognized',cosine_score:.8,relationship:'friend',notes:'Example notes',trackId:1,box:[150,60,80,80]};

test('one face and body become one subject, and focus survives a second person',()=>{
  const subjects=combineSubjects([body],[face]);
  expect(subjects).toHaveLength(1);expect(subjects[0].face?.id).toBe('alice');
  expect(choosePrimary(subjects,null)).toBe('body-1');
  const second={...body,trackId:2,box:[350,20,180,320] as CameraDetection['box']};
  expect(choosePrimary(combineSubjects([second,body],[face]),'body-1')).toBe('body-1');
  expect(choosePrimary(combineSubjects([body,second],[]),null)).toBeNull();
});

test('overlapping people never inherit an ambiguously associated face',()=>{
  const other={...body,trackId:2};
  const subjects=combineSubjects([body,other],[face]);
  expect(subjects.filter(s=>s.body && s.face)).toHaveLength(0);
  expect(subjects.find(s=>s.key==='face-1')?.face?.id).toBe('alice');
  expect(choosePrimary([], 'body-1')).toBeNull();
});

test('body focus continues through hidden faces without retaining identity',()=>{
  const visible=combineSubjects([body],[face]);
  const hidden=combineSubjects([body],[]);
  expect(choosePrimary(hidden,choosePrimary(visible,null))).toBe('body-1');
  expect(hidden[0].face).toBeUndefined();
});

test('camera automatically focuses one person and keeps labels outside the video',async({page})=>{
  await page.addInitScript(()=>{
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
      const c=document.createElement('canvas');c.width=640;c.height=360;
      const ctx=c.getContext('2d')!;let n=0;
      const paint=()=>{ctx.fillStyle=++n%2?'#2b414e':'#6e8a8b';ctx.fillRect(0,0,640,360);ctx.fillStyle='#b2b9bd';ctx.fillRect(100,20,180,320);};
      paint();setInterval(paint,500);return c.captureStream(10);
    }});
  });
  let covered=false, multiple=false;
  await page.route('**/api/v1/people/identify*',r=>r.fulfill({json:{identified:covered?[]:[face]}}));
  await page.route('**/api/v1/vision/detect*',r=>r.fulfill({json:{detections:[body,{class:'clock',confidence:.8,box:[400,40,50,50]},...(multiple?[{class:'person',confidence:.8,box:[350,20,180,320]}]:[])]}}));
  await page.route('**/api/v1/vision/objects/identify',r=>r.fulfill({json:{description:'No held object visible',is_estimate:true}}));
  await page.goto('/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>Boolean(window.ORACLE));await page.keyboard.press('Escape');
  await page.getByTitle('Toggle optical vision feed',{exact:true}).click();
  const panel=page.locator('.oracle-camera-card');
  await expect(panel.getByText('Alice',{exact:true})).toBeVisible({timeout:15000});
  await expect(page.locator('[data-subject]')).toHaveCount(1);
  await expect(page.locator('.camera-object-outline')).toHaveCount(0);
  await expect(page.locator('.camera-viewport-frame')).not.toContainText(/alice/i);
  const viewport=await page.locator('.camera-viewport-frame').boundingBox();
  const label=await panel.getByText('Alice',{exact:true}).boundingBox();
  expect(label!.y+label!.height<=viewport!.y || label!.y>=viewport!.y+viewport!.height-1).toBe(true);
  await panel.getByRole('button',{name:'Details',exact:true}).click();
  await expect(panel.locator('.camera-details-drawer').getByText('0.800',{exact:true})).toBeVisible();
  await panel.getByRole('button',{name:'Details',exact:true}).click();
  await panel.getByRole('checkbox',{name:/show all objects/i}).check();
  await expect(page.locator('.camera-object-outline')).toHaveCount(1);
  await panel.getByRole('checkbox',{name:/show all objects/i}).uncheck();
  await page.locator('.oracle-camera-card').screenshot({path:'../data/person-focus-preview.png'});
  covered=true;
  await expect(panel.getByText('Face hidden or not detected',{exact:true})).toBeVisible({timeout:10000});
  await expect(panel.getByText('Alice',{exact:true})).toHaveCount(0);
  await expect(page.locator('[data-subject="body-1"]')).toHaveCount(1);
  multiple=true;
  await expect(panel.getByRole('combobox',{name:'Focus person',exact:true})).toHaveValue('body-1',{timeout:10000});
  await panel.getByRole('combobox',{name:'Focus person',exact:true}).selectOption('body-3');
  await expect(page.locator('[data-subject="body-3"]')).toHaveCount(1);
  await expect(page.locator('[data-subject="body-1"]')).toHaveCount(0);
  await page.setViewportSize({width:375,height:812});
  await expect(panel).toBeVisible();
  const bounds=await page.locator('.oracle-camera-card').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(375);
  await page.setViewportSize({width:812,height:375});
  const shortBounds=await page.locator('.oracle-camera-card').boundingBox();
  expect(shortBounds!.y).toBeGreaterThanOrEqual(0);
  expect(shortBounds!.height).toBeLessThanOrEqual(327);
  await expect(page.locator('.oracle-camera-card')).toHaveCSS('overflow-y','auto');
});
