import { useEffect, useRef, useState } from 'react';
import { localApi, fetchWithAuth, readJson } from '../utils/api';

type Source={title:string;url:string;snippet:string};
type Passage={id?:number;page?:number;line:number;column:number;text:string};
export function ResearchTools(){
  const [query,setQuery]=useState(''),[question,setQuestion]=useState('');
  const [document,setDocument]=useState<{name:string;text:string;pages?:string[]}|null>(null);
  const [provider,setProvider]=useState('wikipedia');
  const [claims,setClaims]=useState<{text:string;source:number;quote:string}[]>([]);
  const [sources,setSources]=useState<Source[]>([]),[passages,setPassages]=useState<Passage[]>([]);
  const [status,setStatus]=useState(''),[busy,setBusy]=useState(false);
  const pending=useRef<AbortController|null>(null),version=useRef(0);
  useEffect(()=>()=>{version.current++;pending.current?.abort();},[]);
  async function run(path:string,body:unknown){
    if(pending.current)return;
    const controller=new AbortController();pending.current=controller;setBusy(true);setStatus('Working…');
    setSources([]);setPassages([]);setClaims([]);
    try{const data=await localApi<any>(`research/${path}`,'POST',body,controller.signal);
      if(controller.signal.aborted)return;
      if(path==='search')setSources(data.results);else {setPassages(data.passages);setClaims(data.claims||[]);}
      setStatus(`${data.notice} ${path==='search'&&!data.results.length?'No results.':''}${path==='document'&&!data.found?'No matching evidence found.':''}`);
    }catch(error){if(!controller.signal.aborted)setStatus(String(error));}
    finally{if(pending.current===controller){pending.current=null;setBusy(false);}}
  }
  return <section className="research-tools record-content" aria-label="Research tools">
    <h3>RESEARCH</h3>
    <p>Search queries go online. Documents are not saved. AI answers use only the local model, with no cloud fallback.</p>
    <form onSubmit={e=>{e.preventDefault();void run('search',{query,provider});}}>
      <label>Search provider<select disabled={busy} value={provider} onChange={e=>setProvider(e.target.value)}><option value="wikipedia">Wikipedia</option><option value="searxng">Local SearXNG (requires setup)</option></select></label>
      <label>Search Wikipedia<input required maxLength={200} value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <button disabled={busy}>Search sources</button>
    </form>
    <label>Document file (TXT / Markdown / PDF, up to 20,000 extracted characters)
      <input type="file" accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf" disabled={busy} onChange={async e=>{
        const file=e.target.files?.[0];e.target.value='';const current=++version.current;
        setDocument(null);setPassages([]);setClaims([]);setStatus('');if(!file)return;
        try{
          if(/\.pdf$/i.test(file.name)){
            if(file.size>5*1024*1024)throw new Error('PDF limit: 5 MB and 40 pages.');
            const controller=new AbortController();pending.current=controller;setBusy(true);setStatus('Extracting PDF locally…');
            try{const data=await readJson<{pages:{page:number;text:string}[]}>(await fetchWithAuth('/api/v1/research/pdf',{method:'POST',headers:{'Content-Type':'application/pdf'},body:file,signal:controller.signal}));
              if(!controller.signal.aborted&&version.current===current){const pages=data.pages.map(page=>page.text);setDocument({name:file.name,text:'PDF document',pages});setStatus('PDF extracted locally. Page references are available.');}
            }finally{if(pending.current===controller){pending.current=null;setBusy(false);}}
            return;
          }
          if(file.size>80000||! /\.(txt|md)$/i.test(file.name))throw new Error('Choose TXT/Markdown under 80 KB, or a PDF under 5 MB.');
          const text=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
          if(text.length>20000||!text.trim()||text.includes('\0'))throw new Error('Use a nonempty text document of up to 20,000 characters.');
          if(version.current===current)setDocument({name:file.name,text});
        }catch(error){if(version.current===current)setStatus(String(error));}
      }}/>
    </label>
    {document&&<form onSubmit={e=>{e.preventDefault();void run('document',{...document,question,mode:'question'});}}>
      <p>{document.name}</p>
      <label>Question about this document<input required maxLength={1000} value={question} onChange={e=>setQuestion(e.target.value)}/></label>
      <button disabled={busy}>Find evidence</button>
      <button type="button" disabled={busy} onClick={()=>void run('answer',{...document,question,mode:'question'})}>Answer with local AI</button>
      <button type="button" disabled={busy} onClick={()=>void run('answer',{...document,mode:'summary'})}>Summarize selected passages</button>
      <button type="button" disabled={busy} onClick={()=>void run('document',{...document,mode:'summary'})}>Preview opening passages</button>
      <button type="button" disabled={busy} onClick={()=>{version.current++;setDocument(null);setPassages([]);setClaims([]);setStatus('Document cleared.');}}>Clear document</button>
    </form>}
    {busy&&<button onClick={()=>{version.current++;pending.current?.abort();pending.current=null;setBusy(false);setStatus('Stopped.');}}>Stop research</button>}
    <p role="status">{status}</p>
    {claims.map((claim,index)=><article className="record-row" key={index}><p>{claim.text} [{claim.source}]</p><blockquote>{claim.quote}</blockquote></article>)}
    {sources.map(source=><article className="record-row" key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{source.title}</a><p>{source.snippet}</p></article>)}
    {passages.map(passage=><blockquote key={`${passage.page||0}:${passage.line}:${passage.column}`}><p>{passage.text}</p><cite>{passage.id?`[${passage.id}] `:''}{document?.name} · {passage.page?`page ${passage.page}, `:''}line {passage.line}, column {passage.column}</cite></blockquote>)}
  </section>;
}
