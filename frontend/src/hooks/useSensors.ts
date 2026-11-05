import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWithAuth, readJson } from '../utils/api';
export type SensorColor='gray'|'green'|'blue'|'red';
export interface SensorStatus {state:SensorColor;label:string;detail:string}
export interface SensorsTelemetry {mic:SensorStatus;camera:SensorStatus;chat:SensorStatus;cameraStream:MediaStream|null;toggleMic:()=>Promise<void>;toggleCamera:()=>Promise<void>;pingChat:()=>Promise<void>;stopCamera:()=>void;selectCamera:(deviceId:string)=>Promise<void>}
export function useSensors(mode:string):SensorsTelemetry {
  const [cameraStream,setCameraStream]=useState<MediaStream|null>(null);
  const [camera,setCamera]=useState<SensorStatus>({state:'gray',label:'Camera',detail:'Off'});
  const [chat,setChat]=useState<SensorStatus>({state:'gray',label:'Chat',detail:'Checking gateway'});
  const stream=useRef<MediaStream|null>(null),generation=useRef(0),pending=useRef(false),mounted=useRef(false);
  const stopCamera=useCallback(()=>{generation.current++;stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;setCameraStream(null);setCamera({state:'gray',label:'Camera',detail:'Off'});},[]);
  const toggleCamera=useCallback(async()=>{
    if(stream.current||pending.current){stopCamera();return;}
    const version=++generation.current;pending.current=true;setCamera({state:'gray',label:'Camera',detail:'Requesting camera permission'});
    try{const next=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720}},audio:false});
      if(!mounted.current||version!==generation.current||document.hidden){next.getTracks().forEach(track=>track.stop());return;}
      stream.current=next;setCameraStream(next);setCamera({state:'green',label:'Camera',detail:'Live local preview'});
      next.getVideoTracks()[0]?.addEventListener('ended',stopCamera,{once:true});
    }catch(error){if(mounted.current&&version===generation.current)setCamera({state:'red',label:'Camera',detail:error instanceof Error?error.message:'Camera unavailable'});}
    finally{pending.current=false;}
  },[stopCamera]);
  const selectCamera=useCallback(async(deviceId:string)=>{
    if(pending.current) throw new Error('A camera request is already in progress.');
    const version=++generation.current;
    pending.current=true;
    try {
      const next=await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:deviceId},width:{ideal:1280},height:{ideal:720}},audio:false});
      if(!mounted.current||version!==generation.current||document.hidden){next.getTracks().forEach(track=>track.stop());return;}
      const previous=stream.current;
      stream.current=next;
      setCameraStream(next);
      setCamera({state:'green',label:'Camera',detail:'Live local preview'});
      previous?.getTracks().forEach(track=>track.stop());
      next.getVideoTracks()[0]?.addEventListener('ended',()=>{if(stream.current===next)stopCamera();},{once:true});
    } finally {pending.current=false;}
  },[stopCamera]);
  const check=useRef<AbortController|null>(null);
  const pingChat=useCallback(async()=>{
    if(check.current)return;const controller=new AbortController();check.current=controller;const started=performance.now();
    try{const data=await readJson<{model:{available:boolean;provider:string;name:string}}>(await fetchWithAuth('/api/v1/capabilities',{signal:controller.signal}));
      if(mounted.current&&!controller.signal.aborted)setChat({state:data.model.available?'green':'gray',label:'Chat',detail:data.model.available?`${data.model.provider} · ${data.model.name} · gateway ${Math.round(performance.now()-started)}ms`:'Gateway connected; AI provider not configured'});
    }catch(error){if(mounted.current&&!controller.signal.aborted)setChat({state:'red',label:'Chat',detail:String(error)});}
    finally{if(check.current===controller)check.current=null;}
  },[]);
  useEffect(()=>{mounted.current=true;void pingChat();const poll=setInterval(()=>{if(!document.hidden)void pingChat();},15000);
    const hide=()=>{if(document.hidden)stopCamera();};document.addEventListener('visibilitychange',hide);
    return()=>{mounted.current=false;generation.current++;stream.current?.getTracks().forEach(track=>track.stop());stream.current=null;check.current?.abort();check.current=null;clearInterval(poll);document.removeEventListener('visibilitychange',hide);};
  },[pingChat,stopCamera]);
  useEffect(()=>{if(mode==='dormant'||mode==='initializing')stopCamera();},[mode,stopCamera]);
  return {mic:{state:'gray',label:'Microphone',detail:'Off'},camera,chat:mode==='thinking'||mode==='speaking'?{...chat,state:'blue',detail:mode==='thinking'?'Waiting for response':'Playing speech'}:chat,cameraStream,toggleMic:async()=>{},toggleCamera,pingChat,stopCamera,selectCamera};
}
