import {test,expect} from '@playwright/test';

test('Google setup shows actual project and disables connection without credentials',async({page})=>{
  await page.route('**/api/v1/google/status',r=>r.fulfill({json:{configured:false,connected:false,offline_access:false,project_id:'oracle-5ac86',redirect_uri:'http://127.0.0.1:8000/api/v1/google/callback'}}));
  await page.goto('/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>Boolean(window.ORACLE));await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Workspace',exact:true}).first().click();await page.getByRole('button',{name:'Google',exact:true}).click();
  const panel=page.getByRole('region',{name:'Google Calendar and Tasks'});
  await expect(panel).toContainText('oracle-5ac86');await expect(panel.getByRole('button',{name:'Sign in with Google',exact:true})).toBeDisabled();
  await expect(panel.getByRole('status')).toContainText('setup required');
});

test('one Google sign-in detects account and service access automatically',async({page})=>{
  let connected=false,starts=0;
  await page.route('https://accounts.google.com/**',r=>r.fulfill({contentType:'text/html',body:'<title>Test consent</title>'}));
  await page.route('**/api/v1/google/**',r=>{
    const path=new URL(r.request().url()).pathname;
    let data:any={};
    if(path.endsWith('/status'))data={configured:true,connected,signed_in:connected,offline_access:connected,account:connected?{email:'tester@example.com'}:null,project_id:'oracle-5ac86'};
    else if(path.endsWith('/connect')){starts++;connected=true;data={url:'https://accounts.google.com/o/oauth2/v2/auth?state=test-state'};}
    else if(path.endsWith('/calendars'))data={calendars:[]};
    else if(path.endsWith('/tasklists'))data={tasklists:[]};
    else if(path.endsWith('/tasks'))data={tasks:[]};
    else if(path.endsWith('/events'))data={events:[]};
    return r.fulfill({json:data});
  });
  await page.goto('/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>Boolean(window.ORACLE));await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Workspace',exact:true}).first().click();await page.getByRole('button',{name:'Google',exact:true}).click();
  const panel=page.getByRole('region',{name:'Google Calendar and Tasks'});
  await panel.getByRole('button',{name:'Sign in with Google',exact:true}).click();
  await expect(panel.getByRole('status')).toContainText('Signed in as tester@example.com');
  await expect(panel.getByRole('button',{name:'Sign in with Google',exact:true})).toHaveCount(0);
  await expect(panel.getByRole('button',{name:'Load Google events & tasks',exact:true})).toBeVisible();expect(starts).toBe(1);
});

test('connected Google view writes only on explicit submission and preserves date-only task semantics',async({page})=>{
  let eventWrites=0,taskWrites=0,taskComplete=0;
  await page.route('**/api/v1/google/**',async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname,method=request.method();
    let data:any={};
    if(path.endsWith('/status'))data={configured:true,connected:true,offline_access:true,project_id:'oracle-5ac86'};
    else if(path.endsWith('/calendars'))data={calendars:[{id:'primary',summary:'Personal',accessRole:'owner'}]};
    else if(path.endsWith('/tasklists'))data={tasklists:[{id:'work',title:'Work'}]};
    else if(path.endsWith('/events')&&method==='GET')data={events:[]};
    else if(path.endsWith('/events')){eventWrites++;const body=request.postDataJSON();expect(body.start).toMatch(/Z$/);expect(body.operation_id).toMatch(/^[a-f0-9]{32}$/);data={notice:'Created in Google Calendar.'};}
    else if(path.endsWith('/tasks')&&method==='GET')data={tasks:[{id:'t1',title:'Read plan',status:'needsAction',due:'2026-12-12T00:00:00Z'}]};
    else if(path.endsWith('/tasks')&&method==='POST'){taskWrites++;expect(request.postDataJSON().due_date).toBe('2026-12-12');data={notice:'Google task created.'};}
    else if(method==='PATCH'){taskComplete++;data={updated:true};}
    await route.fulfill({json:data});
  });
  await page.goto('/',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>Boolean(window.ORACLE));await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Workspace',exact:true}).first().click();await page.getByRole('button',{name:'Google',exact:true}).click();
  const panel=page.getByRole('region',{name:'Google Calendar and Tasks'});
  await expect(panel.getByRole('button',{name:'Load Google events & tasks',exact:true})).toBeVisible();expect(eventWrites+taskWrites).toBe(0);
  await panel.getByRole('button',{name:'Load Google events & tasks',exact:true}).click();await expect(panel).toContainText('Read plan');
  await panel.getByLabel('Google event title',{exact:true}).fill('Review');await panel.getByLabel('Event starts',{exact:true}).fill('2026-12-12T10:00');await panel.getByLabel('Event ends',{exact:true}).fill('2026-12-12T10:15');
  await panel.getByRole('button',{name:'Create in Google Calendar',exact:true}).click();await expect.poll(()=>eventWrites).toBe(1);
  await panel.getByLabel('Google task title',{exact:true}).fill('Read');await panel.getByLabel('Google task due date',{exact:true}).fill('2026-12-12');await panel.getByRole('button',{name:'Create Google task',exact:true}).click();await expect.poll(()=>taskWrites).toBe(1);
  await panel.getByRole('button',{name:'Complete Google task',exact:true}).click();await expect.poll(()=>taskComplete).toBe(1);
});
