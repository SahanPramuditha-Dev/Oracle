import { useEffect, useRef, useState } from 'react';
import { localApi } from '../utils/api';

type Status={configured:boolean;connected:boolean;signed_in?:boolean;account?:{email:string}|null;offline_access:boolean;project_id?:string;redirect_uri:string;notice?:string};
type Calendar={id:string;summary:string;accessRole:string};
type List={id:string;title:string};
type Event={id:string;summary:string;start?:{dateTime?:string;date?:string}};
type Task={id:string;title:string;status:string;due?:string};
type Reminder={id:string;title:string;due:number;kind:string};
function localTime(value:number){const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);}
export function GoogleWorkspace(){
  const [status,setStatus]=useState<Status|null>(null),[message,setMessage]=useState('Checking Google connection…'),[busy,setBusy]=useState(false);
  const [calendars,setCalendars]=useState<Calendar[]>([]),[lists,setLists]=useState<List[]>([]);
  const [calendar,setCalendar]=useState('primary'),[list,setList]=useState('@default');
  const [events,setEvents]=useState<Event[]>([]),[tasks,setTasks]=useState<Task[]>([]),[reminders,setReminders]=useState<Reminder[]>([]);
  const [title,setTitle]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState(''),[minutes,setMinutes]=useState('10');
  const [taskTitle,setTaskTitle]=useState(''),[date,setDate]=useState('');
  const operation=useRef(crypto.randomUUID().replaceAll('-',''));
  const active=useRef(true),flight=useRef(false),pending=useRef(new AbortController());
  const signIn=useRef<AbortController|null>(null),popupRef=useRef<Window|null>(null);
  const signInState=useRef<string|null>(null);
  const [signingIn,setSigningIn]=useState(false);
  const eventPath=`google/events?calendar_id=${encodeURIComponent(calendar)}`;
  const tasksPath=`google/tasks?tasklist_id=${encodeURIComponent(list)}`;
  useEffect(()=>{active.current=true;return()=>{active.current=false;pending.current.abort();signIn.current?.abort();popupRef.current?.close();};},[]);
  async function run(action:()=>Promise<void>){if(flight.current)return;flight.current=true;setBusy(true);setMessage('Working…');
    try{await action();}catch(error){if(active.current)setMessage(String(error));}finally{flight.current=false;if(active.current)setBusy(false);}}
  async function load(){
    const state=await localApi<Status>('google/status','GET',undefined,pending.current.signal);if(!active.current)return;setStatus(state);
    if(!state.connected){setEvents([]);setTasks([]);setCalendars([]);setLists([]);setMessage(state.notice||(state.configured?'Ready to connect.':'Google OAuth setup required.'));return;}
    const [c,l,r]=await Promise.all([localApi<{calendars:Calendar[];more:boolean}>('google/calendars','GET',undefined,pending.current.signal),localApi<{tasklists:List[];more:boolean}>('google/tasklists','GET',undefined,pending.current.signal),localApi<{tasks:Reminder[]}>('tasks','GET',undefined,pending.current.signal)]);
    if(!active.current)return;setCalendars(c.calendars);setLists(l.tasklists);setReminders(r.tasks.filter(item=>item.kind==='reminder'));
    setMessage(`Google connected. Manual refresh only.${c.more||l.more?' More calendars/task lists exist than this view shows.':''}`);
  }
  useEffect(()=>{void run(load);},[]);
  async function refreshItems(){const [e,t]=await Promise.all([localApi<{events:Event[];more:boolean}>(eventPath,'GET',undefined,pending.current.signal),localApi<{tasks:Task[];more:boolean}>(tasksPath,'GET',undefined,pending.current.signal)]);
    if(!active.current)return;setEvents(e.events);setTasks(t.tasks);setMessage(`Refreshed Google events and tasks.${e.more||t.more?' Showing the first 100 results; more items are available in Google.':''}`);}
  async function finishSignIn(popup:Window,controller:AbortController){
    const deadline=Date.now()+600000;
    while(active.current&&!controller.signal.aborted&&Date.now()<deadline){
      const state=await localApi<Status>('google/status','GET',undefined,controller.signal);
      if(state.signed_in&&state.connected){
        popup.close();await load();await refreshItems();
        if(active.current)setMessage(`Signed in as ${state.account?.email||'your Google account'}. Calendar and Tasks are connected.`);
        return;
      }
      await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);controller.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,1500);controller.signal.addEventListener('abort',done,{once:true});});
    }
    if(active.current)setMessage(controller.signal.aborted?'Google sign-in cancelled.':'Google sign-in expired. Please try again.');
  }
  return <section className="google-workspace" aria-label="Google Calendar and Tasks">
    <h3>Google Calendar & Tasks</h3>
    <p>Project: {status?.project_id||'not configured'}. Google data is read on request. Nothing is synchronized automatically.</p>
    <p role="status">{message}</p>
    {status?.signed_in&&status.account&&<p>Signed in with Google: <strong>{status.account.email}</strong></p>}
    <button disabled={busy} onClick={()=>void run(load)}>Refresh Google connection</button>
    {!status?.signed_in&&<button disabled={busy||!status?.configured} onClick={()=>{
      const popup=window.open('about:blank','oracle-google-connect','popup,width=560,height=720');
      if(popup)popup.opener=null;
      if(!popup){setMessage('Allow popups for ORACLE, then sign in again.');return;}
      popupRef.current=popup;
      signInState.current=null;
      const controller=new AbortController();signIn.current=controller;setSigningIn(true);
      void run(async()=>{try{const data=await localApi<{url:string}>('google/connect','POST',undefined,controller.signal);
        signInState.current=new URL(data.url).searchParams.get('state');
        popup.location.href=data.url;setMessage('Choose your Google account and approve Calendar and Tasks access. This view will update automatically.');
        await finishSignIn(popup,controller);
      }catch(error){if(controller.signal.aborted){if(active.current)setMessage('Google sign-in cancelled.');}else throw error;}
      finally{popup.close();popupRef.current=null;signIn.current=null;if(active.current)setSigningIn(false);}});
    }}>Sign in with Google</button>}
    {signingIn&&<button onClick={()=>{signIn.current?.abort();popupRef.current?.close();void localApi('google/cancel-sign-in','POST',{state:signInState.current}).catch(()=>{if(active.current)setMessage('Sign-in closed locally. Start a new sign-in to replace the old request.');});}}>Cancel Google sign-in</button>}
    {!status?.configured&&<p>Enable Calendar API and Tasks API in this project, then place the web OAuth client file in backend/google-client.json. Authorized redirect: {status?.redirect_uri||'http://127.0.0.1:8000/api/v1/google/callback'}. A Firebase login token or Gemini key cannot replace this offline-access setup.</p>}
    {status?.connected&&<>
      <p>{status.offline_access?'Refresh access is stored securely for this Windows user.':'Offline access was not granted; reconnect when access expires.'}</p>
      <button disabled={busy} onClick={()=>void run(async()=>{const data=await localApi<{notice:string}>('google/disconnect','POST');await load();setMessage(data.notice);})}>Disconnect Google</button>
      <label>Google calendar<select value={calendar} disabled={busy} onChange={e=>{setCalendar(e.target.value);setEvents([]);operation.current=crypto.randomUUID().replaceAll('-','');}}><option value="primary">Primary calendar</option>{calendars.map(item=><option key={item.id} value={item.id}>{item.summary} ({item.accessRole})</option>)}</select></label>
      <label>Google task list<select value={list} disabled={busy} onChange={e=>{setList(e.target.value);setTasks([]);}}><option value="@default">Default task list</option>{lists.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <button disabled={busy} onClick={()=>void run(refreshItems)}>Load Google events & tasks</button>
      <h4>Upcoming Google events (14 days)</h4>
      {events.map(item=><article className="record-row" key={item.id}><strong>{item.summary||'Untitled event'}</strong><p>{item.start?.dateTime?new Date(item.start.dateTime).toLocaleString():item.start?.date}</p></article>)}
      <h4>Calendar event or timed reminder</h4>
      <p>Creating here writes to the selected Google calendar. Calendar notifications depend on your Google device settings. Local reminders stay separate.</p>
      {reminders.length>0&&<label>Prefill from a local reminder<select disabled={busy} defaultValue="" onChange={e=>{const item=reminders.find(r=>r.id===e.target.value);if(item){setTitle(item.title);setStart(localTime(item.due));setEnd(localTime(item.due+15*60000));setMinutes('0');operation.current=crypto.randomUUID().replaceAll('-','');}}}><option value="">Choose a reminder</option>{reminders.map(item=><option value={item.id} key={item.id}>{item.title}</option>)}</select></label>}
      <form onSubmit={e=>{e.preventDefault();void run(async()=>{
        const data=await localApi<{notice:string}>(eventPath,'POST',{title,start:new Date(start).toISOString(),end:new Date(end).toISOString(),reminder_minutes:Number(minutes),operation_id:operation.current});
        if(!active.current)return;operation.current=crypto.randomUUID().replaceAll('-','');setTitle('');setStart('');setEnd('');await refreshItems();setMessage(data.notice);
      });}}>
        <label>Google event title<input required maxLength={200} disabled={busy} value={title} onChange={e=>setTitle(e.target.value)}/></label>
        <label>Event starts<input type="datetime-local" required disabled={busy} value={start} onChange={e=>setStart(e.target.value)}/></label>
        <label>Event ends<input type="datetime-local" required disabled={busy} value={end} onChange={e=>setEnd(e.target.value)}/></label>
        <label>Notify minutes before<input type="number" min="0" max="40320" required disabled={busy} value={minutes} onChange={e=>setMinutes(e.target.value)}/></label>
        <button disabled={busy}>Create in Google Calendar</button>
      </form>
      <h4>Google tasks</h4><p>Due dates have no time-of-day or reminder settings through the Tasks API. Use Calendar above for timed notifications.</p>
      {tasks.map(item=><article className="record-row" key={item.id}><strong>{item.title}</strong><p>{item.status} {item.due?`· due ${item.due.slice(0,10)}`:''}</p><button disabled={busy} onClick={()=>void run(async()=>{await localApi(`google/tasks/${encodeURIComponent(item.id)}?tasklist_id=${encodeURIComponent(list)}`,'PATCH',{completed:item.status!=='completed'});await refreshItems();})}>{item.status==='completed'?'Reopen Google task':'Complete Google task'}</button></article>)}
      <form onSubmit={e=>{e.preventDefault();void run(async()=>{const data=await localApi<{notice:string}>(tasksPath,'POST',{title:taskTitle,due_date:date||null});
        if(!active.current)return;setTaskTitle('');setDate('');await refreshItems();setMessage(data.notice);});}}>
        <label>Google task title<input required maxLength={200} disabled={busy} value={taskTitle} onChange={e=>setTaskTitle(e.target.value)}/></label>
        <label>Google task due date<input type="date" disabled={busy} value={date} onChange={e=>setDate(e.target.value)}/></label>
        <button disabled={busy}>Create Google task</button>
      </form>
      <p>Changes are not retried automatically. If a request fails, refresh Google before repeating it.</p>
    </>}
  </section>;
}
