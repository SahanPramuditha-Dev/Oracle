export interface ObjectObservation { class:string; confidence:number; box:[number,number,number,number]; ambiguous?:boolean }
interface Track<T extends ObjectObservation> { detection:T; count:number }
export class ObjectConfirmation<T extends ObjectObservation = ObjectObservation> {
  private tracks:Track<T>[]=[];
  private seen=0;
  constructor(private minConfidence=0, private maxGap=15000, private requiredReads=2) {}
  reset(){this.tracks=[];this.seen=0;}
  update(detections:T[],now:number){
    if(now-this.seen>this.maxGap)this.reset();
    const available=new Set(this.tracks);
    const next=detections.filter(d=>!d.ambiguous && Array.isArray(d.box) && d.box.length===4 && d.box.every(Number.isFinite) && d.box[2]>0 && d.box[3]>0 && Number.isFinite(d.confidence) && d.confidence>=this.minConfidence && d.confidence<=1).map(d=>{
      const [x,y,w,h]=d.box;let previous:Track<T>|undefined;let best=.25;
      for(const t of available){
        if(t.detection.class!==d.class)continue;
        const [a,b,c,e]=t.detection.box;
        const overlap=Math.max(0,Math.min(x+w,a+c)-Math.max(x,a))*Math.max(0,Math.min(y+h,b+e)-Math.max(y,b));
        const iou=overlap/Math.max(1,w*h+c*e-overlap);
        if(iou>best){best=iou;previous=t;}
      }
      if(previous)available.delete(previous);
      return {detection:d,count:previous?previous.count+1:1};
    });
    this.tracks=next;this.seen=now;
    return next.map(t=>({...t.detection,confirmed:t.count>=this.requiredReads}));
  }
}
