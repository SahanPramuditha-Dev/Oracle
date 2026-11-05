import type { FaceObservation } from './faceTracking';
export interface CameraDetection {
  trackId?: number;
  mask?: string;
  class?: string;
  class_name?: string;
  confidence: number;
  box: [number,number,number,number];
}
export interface CameraSubject {
  key: string;
  body?: CameraDetection;
  face?: FaceObservation;
  box: [number,number,number,number];
}
// Associate only faces clearly contained in the upper part of a detected person.
// Reject overlapping/ambiguous assignments rather than transferring a name.
export function combineSubjects(objects:CameraDetection[], faces:FaceObservation[]):CameraSubject[] {
  const bodies=objects.filter(o=>(o.class || o.class_name)==='person');
  const assigned=new Map<CameraDetection,FaceObservation[]>();
  const unmatched:FaceObservation[]=[];
  for(const face of faces){
    const [x,y,w,h]=face.box, cx=x+w/2,cy=y+h/2;
    const candidates=bodies.map(body=>{
      const [a,b,c,d]=body.box;
      const overlap=Math.max(0,Math.min(x+w,a+c)-Math.max(x,a))*Math.max(0,Math.min(y+h,b+d)-Math.max(y,b));
      return {body,coverage:overlap/Math.max(1,w*h),head:cx>=a && cx<=a+c && cy>=b && cy<=b+d*.6};
    }).filter(p=>p.head && p.coverage>=.8).sort((a,b)=>b.coverage-a.coverage);
    if(!candidates.length || (candidates.length>1 && candidates[0].coverage-candidates[1].coverage<.15)){
      unmatched.push(face);continue;
    }
    const body=candidates[0].body;
    assigned.set(body,[...(assigned.get(body)||[]),face]);
  }
  const subjects:CameraSubject[]=bodies.map(body=>{
    const matches=assigned.get(body)||[];
    if(matches.length>1)unmatched.push(...matches);
    return {key:`body-${body.trackId}`,body,face:matches.length===1?matches[0]:undefined,box:body.box};
  });
  return [...subjects,...unmatched.map(face=>({key:`face-${face.trackId}`,face,box:face.box}))];
}
export function choosePrimary(subjects:CameraSubject[],current:string|null):string|null {
  if(subjects.some(s=>s.key===current))return current;
  return subjects.length===1?subjects[0].key:null;
}
