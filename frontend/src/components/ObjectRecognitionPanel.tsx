import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { fetchWithAuth } from '../utils/api';
import { ObjectConfirmation } from '../utils/objectTracking';

export function ObjectRecognitionPanel({video,stream,paused,showControls=true}:{video:RefObject<HTMLVideoElement|null>;stream:MediaStream|null;paused:boolean;showControls?:boolean}) {
  const [automatic,setAutomatic]=useState(()=>localStorage.getItem('oracle_held_objects')!=='false');
  const [view,setView]=useState<'frame'|'center'>('frame');
  const [busy,setBusy]=useState(false),[description,setDescription]=useState(''),[error,setError]=useState('');
  const [capturedAt,setCapturedAt]=useState<number|null>(null);
  const confirmation=useRef(new ObjectConfirmation());
  const [detectorSource,setDetectorSource]=useState(false);
  const [candidates,setCandidates]=useState<Array<{class:string;confidence:number;confirmed:boolean}>>([]);
  const request=useRef<AbortController|null>(null);
  const lastAttempt=useRef(0);
  const identify=useCallback(async()=>{
    const source=video.current;
    if(!stream || paused || request.current || !source || source.readyState<2 || !source.videoWidth)return;
    const controller=new AbortController();request.current=controller;lastAttempt.current=Date.now();
    setBusy(true);setError('');setDescription('');setCapturedAt(null);
    const timeout=setTimeout(()=>controller.abort('timeout'),95000);
    try{
      const canvas=document.createElement('canvas');
      const width=source.videoWidth,height=source.videoHeight;
      const cropWidth=view==='center'?width*.5:width,cropHeight=view==='center'?height*.5:height;
      const scale=Math.min(1,1280/Math.max(cropWidth,cropHeight));
      canvas.width=Math.max(1,Math.round(cropWidth*scale));canvas.height=Math.max(1,Math.round(cropHeight*scale));
      canvas.getContext('2d')!.drawImage(source,(width-cropWidth)/2,(height-cropHeight)/2,cropWidth,cropHeight,0,0,canvas.width,canvas.height);
      const snapshotTime=Date.now();
      const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',.92));
      if(!blob || controller.signal.aborted)return;
      const response=await fetchWithAuth('/api/v1/vision/objects/identify',{method:'POST',headers:{'Content-Type':'image/jpeg'},body:blob,signal:controller.signal});
      if(response.status===429){
        // Silently skip if inference is already in flight, preventing error flash
        return;
      }
      const result=await response.json();
      if(!response.ok)throw new Error(result.detail || 'Object recognition unavailable');
      if(!controller.signal.aborted){
        const fromDetector=result.source==='open_vocabulary';setDetectorSource(fromDetector);
        if(fromDetector){
          const observed=confirmation.current.update(result.detections || [],snapshotTime);setCandidates(observed);
          const confirmed=[...new Set(observed.filter(d=>d.confirmed).map(d=>d.class))];
          const pending=[...new Set(observed.filter(d=>!d.confirmed).map(d=>d.class))];
          setDescription(confirmed.length?`Confirmed across frames: ${confirmed.join(', ')}${pending.length?`. Checking: ${pending.join(', ')}`:''}`:pending.length?`Checking across frames: ${pending.join(', ')}`:'Object unclear; move it closer and hold still.');
        }else{
          confirmation.current.reset();setCandidates([]);
          setDescription(typeof result.description==='string'?result.description:'Object unclear; try a closer view.');
        }
        setCapturedAt(snapshotTime);
      }
    }catch(err){
      if(!controller.signal.aborted){
        confirmation.current.reset();
        setCandidates([]);
        const msg=err instanceof Error?err.message:'Object recognition unavailable';
        if(!msg.includes('already running') && !msg.includes('429')){
          setError(msg);
        }
      }else if(controller.signal.reason==='timeout'){
        setError('Object recognition took too long. Try again.');
      }
    }finally{
      clearTimeout(timeout);
      if(request.current===controller){request.current=null;lastAttempt.current=Date.now();setBusy(false);}
    }
  },[video,stream,paused,view]);
  useEffect(()=>{
    const controller=request.current;
    controller?.abort();request.current=null;setBusy(false);setDescription('');setError('');setCapturedAt(null);lastAttempt.current=0;confirmation.current.reset();setCandidates([]);setDetectorSource(false);
    return()=>{request.current?.abort();request.current=null;};
  },[stream,view,paused]);
  useEffect(()=>{
    if(!automatic || !stream || paused)return;
    const timer=setInterval(()=>{if(Date.now()-lastAttempt.current>=8000)void identify();},1500);
    return()=>clearInterval(timer);
  },[automatic,stream,paused,identify]);
  // Results describe a captured frame, never an indefinitely current object.
  useEffect(()=>{
    if(!capturedAt)return;
    const timer=setTimeout(()=>{setDescription('');setCapturedAt(null);setCandidates([]);confirmation.current.reset();},20000);
    return()=>clearTimeout(timer);
  },[capturedAt]);
  return <section className="camera-object-panel" aria-label="Held object recognition">
    <div className="camera-object-heading"><strong>Object recognition</strong><span>{detectorSource?'Local object detector':'Local vision estimate'}</span></div>
    <p role="status">{busy?'Identifying object…':error || description || 'Hold an object toward the camera to identify it.'}</p>
    {showControls && !busy && candidates.length>0 && <details><summary>Detection details</summary><ul>{candidates.map((d,i)=><li key={`${d.class}-${i}`}>{d.class}: score {d.confidence.toFixed(3)} · {d.confirmed?'observed twice':'candidate'}</li>)}</ul></details>}
    {capturedAt && <small>Captured at {new Date(capturedAt).toLocaleTimeString()}</small>}
    {showControls && <><div className="camera-object-controls">
      <button type="button" disabled={busy || paused} onClick={()=>void identify()}>Identify object</button>
      <label><input type="checkbox" checked={automatic} onChange={e=>{setAutomatic(e.target.checked);localStorage.setItem('oracle_held_objects',String(e.target.checked));}}/>Auto identify</label>
      <label>Object view<select aria-label="Object view" value={view} onChange={e=>setView(e.target.value as typeof view)}><option value="frame">Automatic close-ups</option><option value="center">Center close-up</option></select></label>
    </div>
    <p className="camera-object-hint">Automatic close-ups scan the scene and smaller regions. For tiny objects, choose Center close-up and hold the object in the middle of the camera view.</p></>}
  </section>;
}
