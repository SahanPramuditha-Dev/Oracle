import { test,expect } from '@playwright/test';

test('named people have one label and held objects use local vision automatically',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('oracle_held_objects','true');
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
      const ctx=canvas.getContext('2d')!;let n=0;
      setInterval(()=>{ctx.fillStyle=++n%2?'#172938':'#335361';ctx.fillRect(0,0,640,360);},250);
      return canvas.captureStream(10);
    }});
  });
  const dimensions:number[][]=[];
  await page.route('**/api/v1/people/identify*',r=>r.fulfill({json:{identified:[{id:'sahan',name:'Sahan',matched:true,recognition_state:'recognized',cosine_score:.8,box:[150,60,80,80],relationship:'owner'}]}}));
  await page.route('**/api/v1/vision/detect*',r=>r.fulfill({json:{detections:[{class:'person',confidence:.9,box:[100,20,180,320]},{class:'clock',confidence:.8,box:[400,40,50,50]}]}}));
  await page.route('**/api/v1/vision/objects/identify',async r=>{
    const bytes=Array.from(r.request().postDataBuffer()!);
    const size=await page.evaluate(async bytes=>{const img=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/jpeg'}));return [img.width,img.height];},bytes);
    dimensions.push(size);await r.fulfill({json:{description:'A blue ballpoint pen.',is_estimate:true,processing:'local'}});
  });
  await page.goto('/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>Boolean(window.ORACLE));await page.keyboard.press('Escape');
  await page.getByTitle('Toggle optical vision feed',{exact:true}).click();
  const objects=page.getByRole('region',{name:'Held object recognition',exact:true});
  await expect(objects.getByText('A blue ballpoint pen.',{exact:true})).toBeVisible({timeout:10000});
  await expect(objects.getByText('Local vision estimate',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Details',exact:true}).click();
  await objects.getByRole('checkbox',{name:'Auto identify',exact:true}).uncheck();
  const focus=page.locator('.oracle-camera-card');
  await expect(focus.getByText('Sahan',{exact:true})).toBeVisible({timeout:12000});
  await expect(page.locator('[data-subject]')).toHaveCount(1);
  await focus.getByRole('checkbox',{name:/show all objects/i}).check();
  await expect(page.locator('.camera-object-outline')).toHaveCount(1);
  await expect(page.locator('.camera-object-outline')).not.toContainText(/person/i);
  await page.getByRole('combobox',{name:'Foreground',exact:true}).selectOption('selected');
  await expect(page.getByRole('combobox',{name:'Subject',exact:true}).getByRole('option',{name:'Sahan',exact:true})).toHaveCount(1);
  await objects.getByRole('combobox',{name:'Object view',exact:true}).selectOption('center');
  await objects.getByRole('button',{name:'Identify object',exact:true}).click();
  await expect.poll(()=>dimensions.length).toBe(2);
  expect(dimensions).toEqual([[640,360],[320,180]]);
  await expect(objects.getByText('A blue ballpoint pen.',{exact:true})).toBeVisible();
  await page.locator('.oracle-camera-card').screenshot({path:'../data/held-object-preview.png'});
});

test('closing camera cancels a pending object description',async({page})=>{
  await page.addInitScript(()=>{
    localStorage.setItem('oracle_held_objects','true');
    Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{const c=document.createElement('canvas');c.width=640;c.height=360;c.getContext('2d')!.fillRect(0,0,640,360);return c.captureStream(10);}});
  });
  let release:(()=>void)|undefined;
  await page.route('**/api/v1/people/identify*',r=>r.fulfill({json:{identified:[]}}));
  await page.route('**/api/v1/vision/detect*',r=>r.fulfill({json:{detections:[]}}));
  await page.route('**/api/v1/vision/objects/identify',async r=>{await new Promise<void>(resolve=>release=resolve);await r.fulfill({json:{description:'Stale description'}}).catch(()=>{});});
  await page.goto('/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>Boolean(window.ORACLE));await page.keyboard.press('Escape');
  await page.getByTitle('Toggle optical vision feed',{exact:true}).click();
  await expect.poll(()=>Boolean(release)).toBe(true);
  await page.getByTitle('Close Camera Feed',{exact:true}).click();release?.();
  await expect(page.getByText('Stale description',{exact:true})).toHaveCount(0);
  await expect(page.getByRole('region',{name:'Held object recognition',exact:true})).toHaveCount(0);
});
