import { test, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { FaceConfirmation, type FaceObservation } from '../src/utils/faceTracking';
const face:FaceObservation={id:'a',name:'Alice',matched:true,recognition_state:'recognized',cosine_score:.8,box:[10,10,100,100]};

test('face confirmation resets on loss, identity change, ambiguity and expiry',()=>{
  const t=new FaceConfirmation();
  expect(t.update([face],0)[0].matched).toBe(false);
  expect(t.update([face],1400)[0].matched).toBe(true);
  expect(t.update([{...face,id:'b'}],2800)[0].matched).toBe(false);
  t.update([],4000);
  expect(t.update([face],5400)[0].matched).toBe(false);
  expect(t.update([face],12000)[0].matched).toBe(false);
  expect(t.update([{...face,matched:false,id:null,recognition_state:'uncertain'}],13000)).toHaveLength(0);
  expect(t.update([face],14000)[0].matched).toBe(false);
});

test('profile categories save by ID and photo verification expires',async({page})=>{
  let identity={id:'person_test',name:'Alice',notes:'Personal notes',created:1,relationship:'guest',permission:'standard',enrollment_state:'incomplete',sample_count:1,sample_ids:['sample_test']};
  await page.route('**/api/v1/people',r=>r.fulfill({json:{people:[identity]}}));
  await page.route('**/api/v1/people/person_test',async r=>{
    expect(r.request().method()).toBe('PATCH');identity={...identity,...r.request().postDataJSON()};await r.fulfill({json:identity});
  });
  await page.route('**/api/v1/people/verify?*',r=>{
    expect(new URL(r.request().url()).searchParams.get('person_id')).toBe('person_test');
    return r.fulfill({json:{verified:true,verification_state:'verified',cosine_score:.8,expires_at:Date.now()+1500,access_allowed:false,liveness:'not_evaluated'}});
  });
  await page.goto('/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>Boolean(window.ORACLE));await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Open System Settings & Biometrics',exact:true}).click();
  await page.getByText('Edit profile / verify face',{exact:true}).click();
  await page.getByRole('combobox',{name:'Relationship for person_test',exact:true}).selectOption('family');
  await page.getByRole('combobox',{name:'Permission for person_test',exact:true}).selectOption('administrator');
  await page.getByRole('button',{name:'Save profile',exact:true}).click();
  await expect(page.getByText(/family · administrator · incomplete/)).toBeVisible();
  await page.locator('input[type=file]').setInputFiles(resolve('../data/readiness/vision-fixtures/portrait.jpg'));
  await page.getByRole('button',{name:'Verify selected photo',exact:true}).click();
  await expect(page.getByText(/Face match verified for 30 seconds/)).toBeVisible();
  await expect(page.getByText('A face match does not approve access. Liveness and a second factor have not been checked.',{exact:true})).toBeVisible();
  await page.locator('.person-profile-controls').screenshot({path:'../data/people-profile-preview.png'});
  await expect(page.getByText(/Verification expired/)).toBeVisible({timeout:5000});
});


test('weak and transient unknown detections do not produce face labels', () => {
  const tracker = new FaceConfirmation();
  const unknown = {...face, id: null, matched: false, recognition_state: 'unknown', quality: {detection_score: .95}};
  expect(tracker.update([{...unknown, quality: {detection_score: .7}}], 0)).toEqual([]);
  expect(tracker.update([unknown], 500)).toEqual([]);
  expect(tracker.update([], 1000)).toEqual([]);
  expect(tracker.update([unknown], 1500)).toEqual([]);
  expect(tracker.update([unknown], 2000)).toEqual([]);
  expect(tracker.update([unknown], 2500)).toHaveLength(1);
  expect(tracker.update([], 3000)).toEqual([]);
});
