import { useEffect, useRef, useState } from 'react';
import { localApi } from '../utils/api';
type Task={id:string;title:string;due:number;state:string};
export function ReminderAlerts(){
  const [items,setItems]=useState<Task[]>([]),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const refresh=useRef<()=>void>(()=>{});
  useEffect(()=>{const controller=new AbortController();let timer:ReturnType<typeof setTimeout>;let reading=false;
    const load=async()=>{if(reading||controller.signal.aborted)return;reading=true;
      try{const data=await localApi<{tasks:Task[]}>('tasks','GET',undefined,controller.signal);if(!controller.signal.aborted){setItems(data.tasks.filter(item=>item.state==='alert'));setError('');}}
      catch(error){if(!controller.signal.aborted)setError(String(error));}
      finally{reading=false;if(!controller.signal.aborted){clearTimeout(timer);timer=setTimeout(()=>{if(!document.hidden)void load();else timer=setTimeout(()=>void load(),5000);},5000);}}
    };refresh.current=()=>void load();void load();const visible=()=>{if(!document.hidden)void load();};document.addEventListener('visibilitychange',visible);
    return()=>{controller.abort();clearTimeout(timer);document.removeEventListener('visibilitychange',visible);};
  },[]);
  if(!items.length && !error)return null;
  const first=items[0];
  async function change(snooze:boolean){setBusy(true);try{await localApi(`tasks/${first.id}${snooze?'/snooze':''}`,snooze?'POST':'DELETE',snooze?{minutes:5}:undefined);refresh.current();}catch(error){setError(String(error));}finally{setBusy(false);}}
  return <aside className="reminder-alert" role="alert">{first&&<><strong>{first.title}</strong><p>Due {new Date(first.due).toLocaleString()} {items.length>1?`· ${items.length-1} more due`:''}</p><button disabled={busy} onClick={()=>void change(false)}>Dismiss reminder</button><button disabled={busy} onClick={()=>void change(true)}>Snooze reminder 5 minutes</button></>}<p>{error}</p></aside>;
}
