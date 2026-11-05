import { useEffect, useRef, useState } from 'react';
import { fetchWithAuth, localApi, readJson } from '../utils/api';
export function CaptureReader({image,source}:{image:Blob;source:'camera'|'file'}) {
  const [crop,setCrop]=useState({x:0,y:0,width:100,height:100});
  const [text,setText]=useState(''),[original,setOriginal]=useState(''),[title,setTitle]=useState(''),[qr,setQr]=useState<string[]>([]);
  const [status,setStatus]=useState(''),[busy,setBusy]=useState(false);
  const controller=useRef<AbortController|null>(null);
  const [preview,setPreview]=useState('');
  useEffect(()=>{const url=URL.createObjectURL(image);setPreview(url);return()=>{URL.revokeObjectURL(url);controller.current?.abort();};},[image]);
  async function read(){const request=new AbortController();controller.current=request;setBusy(true);setStatus('Reading in local backend…');
    try{const params=new URLSearchParams(Object.entries(crop).map(([k,v])=>[k,String(v)]));
      const data=await readJson<{text:string;qr:string[]}>(await fetchWithAuth(`/api/v1/images/read?${params}`,{method:'POST',headers:{'Content-Type':image.type||'image/jpeg'},body:image,signal:request.signal}));
      if(!request.signal.aborted){setText(data.text);setOriginal(data.text);setQr(data.qr);setStatus(data.text||data.qr.length?'Read complete. Review and correct before saving.':'No text or QR decoded. Try a clearer crop.');}
    }catch(error){if(!request.signal.aborted)setStatus(String(error));}finally{if(controller.current===request){controller.current=null;setBusy(false);}}
  }
  async function save(memory:boolean){const request=new AbortController();controller.current=request;setBusy(true);
    try{if(memory){const form=new FormData();form.append('image',image,'image');form.append('title',title);form.append('text',text);form.append('ocr_text',original);form.append('source',source);
      await readJson(await fetchWithAuth('/api/v1/memories',{method:'POST',body:form,signal:request.signal}));
    }else await localApi('notes','POST',{title,text},request.signal);
    if(!request.signal.aborted)setStatus(memory?'Image memory saved in backend.':'Text note saved; image not retained.');
    }catch(error){if(!request.signal.aborted)setStatus(String(error));}finally{if(controller.current===request){controller.current=null;setBusy(false);}}
  }
  return <section className="capture-reader" aria-label="Image reader"><p>Read locally or explicitly save a memory. QR contents never open automatically.</p>
    <div className="crop-preview"><img src={preview} alt="Image selected for reading"/><div style={{left:`${crop.x}%`,top:`${crop.y}%`,width:`${crop.width}%`,height:`${crop.height}%`}}/></div>
    <fieldset disabled={busy}><legend>Selected crop (%)</legend><div className="crop-inputs">{(['x','y','width','height'] as const).map(key=><label key={key}>{key}<input aria-label={`Crop ${key}`} type="number" min={key==='x'||key==='y'?0:1} max={100} value={crop[key]} onChange={e=>{setCrop({...crop,[key]:Number(e.target.value)});setText('');setOriginal('');setQr([]);}}/></label>)}</div></fieldset>
    <button disabled={busy} onClick={()=>void read()}>Read text & QR</button>{busy&&<button onClick={()=>{controller.current?.abort();controller.current=null;setBusy(false);setStatus('Stopped waiting. Check records before retrying a save.');}}>Stop image request</button>}
    <p role="status">{status}</p><label>Image title<input value={title} maxLength={200} onChange={e=>setTitle(e.target.value)}/></label><label htmlFor="image-description">Image description / corrected text</label><textarea id="image-description" value={text} maxLength={12000} onChange={e=>setText(e.target.value)}/>
    <div className="record-buttons"><button disabled={busy||!title.trim()||!text.trim()} onClick={()=>void save(false)}>Save text as note</button><button disabled={busy||!title.trim()||!text.trim()} onClick={()=>void save(true)}>Save image memory</button></div>
    {qr.map((payload,index)=><pre className="qr-preview" key={index}>{payload}</pre>)}
  </section>;
}
