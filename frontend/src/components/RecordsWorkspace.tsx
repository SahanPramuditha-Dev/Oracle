import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWithAuth, localApi } from '../utils/api';
import { GoogleWorkspace } from './GoogleWorkspace';
type Note={id:string;title:string;text:string;updated:number};
type Task={id:string;title:string;due:number;state:'pending'|'alert';kind:'timer'|'reminder'};
type Memory=Note & {created:number;source:string};
function SavedImage({id}:{id:string}) {
  const [url,setUrl]=useState('');const [error,setError]=useState('');
  useEffect(()=>{const controller=new AbortController();const owned={url:''};
    void fetchWithAuth(`/api/v1/memories/${id}/image`,{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error('Saved image unavailable.');const blob=await response.blob();
      if(!controller.signal.aborted){owned.url=URL.createObjectURL(blob);setUrl(owned.url);}
    }).catch(error=>{if(!controller.signal.aborted)setError(String(error));});
    return()=>{controller.abort();if(owned.url)URL.revokeObjectURL(owned.url);};},[id]);
  return url?<img className="saved-memory-image" src={url} alt="Saved image memory"/>:<p role="status">{error||'Loading image…'}</p>;
}
export function RecordsWorkspace({onClose}:{onClose:()=>void}) {
  const [tab,setTab]=useState<'notes'|'tasks'|'memories'|'google'>('notes');
  const [notes,setNotes]=useState<Note[]>([]),[tasks,setTasks]=useState<Task[]>([]),[memories,setMemories]=useState<Memory[]>([]);
  const [query,setQuery]=useState(''),[title,setTitle]=useState(''),[text,setText]=useState('');
  const [editing,setEditing]=useState<{id:string;kind:'notes'|'memories'}|null>(null);
  const [seconds,setSeconds]=useState('60'),[when,setWhen]=useState('');
  const [status,setStatus]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0);
  const [shown,setShown]=useState<string|null>(null);
  const loading=useRef<AbortController|null>(null);
  const reload=useCallback(()=>setRefresh(n=>n+1),[]);
  useEffect(()=>{
    if(tab==='google')return;
    const controller=new AbortController();const timer=setTimeout(()=>{
      const path=tab==='tasks'?'tasks':`${tab}?q=${encodeURIComponent(query)}`;
      loading.current=controller;
      void localApi<any>(path,'GET',undefined,controller.signal).then(data=>{
        if(controller.signal.aborted)return;
        if(tab==='notes')setNotes(data.notes);if(tab==='tasks')setTasks(data.tasks);if(tab==='memories')setMemories(data.memories);
      }).catch(error=>{if(!controller.signal.aborted)setStatus(String(error));}).finally(()=>{if(loading.current===controller)loading.current=null;});
    },150);
    return()=>{clearTimeout(timer);controller.abort();};
  },[tab,query,refresh]);
  useEffect(()=>{const tick=setInterval(()=>{if(!document.hidden&&!loading.current)reload();},5000);return()=>clearInterval(tick);},[reload]);
  async function mutate(path:string,method:string,body?:unknown){
    setBusy(true);setStatus('');try{await localApi(path,method,body);reload();setStatus('Saved.');return true;}
    catch(error){setStatus(String(error));return false;}finally{setBusy(false);}
  }
  function switchTab(next:typeof tab){setTab(next);setQuery('');setTitle('');setText('');setEditing(null);setShown(null);setStatus('');}
  return <section className="hud-backdrop records-backdrop"><div className="hud-drawer record-workspace" role="dialog" aria-modal="true" aria-label="Records workspace">
    <header className="hud-header"><h2>WORKSPACE</h2><button onClick={onClose} aria-label="Close workspace">Close</button></header>
    <nav className="hud-suggestions" aria-label="Record categories">{(['notes','tasks','memories','google'] as const).map(name=><button className="hud-chip" aria-pressed={tab===name} key={name} onClick={()=>switchTab(name)}>{name==='tasks'?'Reminders & timers':name==='notes'?'Notes':name==='google'?'Google':'Memories'}</button>)}</nav>
    <div className="record-content" aria-busy={busy}>
      <p>Saved through the local backend. Due alerts require ORACLE to be open; overdue items return after reopening.</p>
      <p role="status">{status}</p><button onClick={reload} disabled={busy}>Refresh records</button>
      {tab==='google'&&<GoogleWorkspace/>}
      {tab!=='tasks'&&tab!=='google'&&<label>Search {tab}<input type="search" maxLength={200} value={query} onChange={e=>setQuery(e.target.value)}/></label>}
      {(tab==='notes'||editing?.kind==='memories')&&<form onSubmit={async e=>{e.preventDefault();if(busy)return;
        if(await mutate(editing?`${editing.kind}/${editing.id}`:'notes',editing?'PUT':'POST',{title,text})){setTitle('');setText('');setEditing(null);}
      }}><label>Record title<input required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label>
      <label htmlFor="record-text">Record text</label><textarea id="record-text" required maxLength={12000} value={text} onChange={e=>setText(e.target.value)}/>
      <button disabled={busy}>{editing?'Update record':'Save note'}</button>{editing&&<button type="button" onClick={()=>{setEditing(null);setTitle('');setText('');}}>Cancel edit</button>}</form>}
      {tab==='notes'&&(notes.length?notes.map(note=><article className="record-row" key={note.id}><h3>{note.title}</h3><p>{note.text}</p><time>{new Date(note.updated).toLocaleString()}</time><div className="record-buttons"><button disabled={busy} onClick={()=>{setEditing({id:note.id,kind:'notes'});setTitle(note.title);setText(note.text);}}>Edit note</button><button disabled={busy} onClick={()=>void mutate(`notes/${note.id}`,'DELETE')}>Delete note</button></div></article>):<p>No matching notes.</p>)}
      {tab==='tasks'&&<><form onSubmit={async e=>{e.preventDefault();if(busy)return;const duration=Number(seconds)*1000;await mutate('tasks','POST',{title:'Timer',kind:'timer',duration_ms:duration,due:Date.now()+duration});}}><label>Timer seconds<input type="number" required min="1" max="86400" value={seconds} onChange={e=>setSeconds(e.target.value)}/></label><button disabled={busy}>Start timer</button></form>
      <form onSubmit={async e=>{e.preventDefault();if(busy)return;if(await mutate('tasks','POST',{title,kind:'reminder',due:new Date(when).getTime()})){setTitle('');setWhen('');}}}><label>Reminder title<input required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>Remind at<input type="datetime-local" required value={when} onChange={e=>setWhen(e.target.value)}/></label><button disabled={busy}>Save reminder</button></form>
      {tasks.length?tasks.map(task=><article className="record-row" key={task.id}><h3>{task.title}</h3><p>{task.state==='alert'?'Due':'Scheduled'} · {new Date(task.due).toLocaleString()}</p><button disabled={busy} onClick={()=>void mutate(`tasks/${task.id}`,'DELETE')}>{task.state==='alert'?'Dismiss':'Cancel task'}</button><button disabled={busy} onClick={()=>void mutate(`tasks/${task.id}/snooze`,'POST',{minutes:5})}>Snooze 5 minutes</button></article>):<p>No timers or reminders.</p>}</>}
      {tab==='memories'&&(memories.length?memories.map(item=><article className="record-row" key={item.id}><h3>{item.title}</h3><p>{item.text}</p><time>Saved {new Date(item.created).toLocaleString()} · {item.source}</time><div className="record-buttons"><button onClick={()=>setShown(shown===item.id?null:item.id)}>View image</button><button disabled={busy} onClick={()=>{setEditing({id:item.id,kind:'memories'});setTitle(item.title);setText(item.text);}}>Edit memory</button><button disabled={busy} onClick={()=>void mutate(`memories/${item.id}`,'DELETE')}>Delete memory</button></div>{shown===item.id&&<SavedImage id={item.id}/>}</article>):<p>No matching memories. Save an image explicitly from the camera attachment reader.</p>)}
    </div>
  </div></section>;
}
