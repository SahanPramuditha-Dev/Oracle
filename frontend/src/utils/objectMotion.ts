import type { CameraDetection } from './personFocus';

export interface MotionSample { detection:CameraDetection; at:number }

// Bridge detector updates with short, bounded movement. Never invent identities,
// keep moving a missing object indefinitely, or extrapolate across a long gap.
export function predictObjectMotion(current:MotionSample, previous:MotionSample|undefined, now:number,
  width:number, height:number):CameraDetection {
  const d=current.detection;
  const elapsed=previous?current.at-previous.at:0;
  if(!previous || d.trackId!==previous.detection.trackId || d.class!==previous.detection.class || elapsed<40 || elapsed>1500)return d;
  const horizon=Math.max(0,Math.min(120,now-current.at));
  const [x,y,w,h]=d.box;
  const [px,py]=previous.detection.box;
  // Large jumps usually indicate reassociation, not continuous object motion.
  if(Math.abs(x-px)>w || Math.abs(y-py)>h)return d;
  const nx=Math.max(0,Math.min(width-w,x+(x-px)/elapsed*horizon));
  const ny=Math.max(0,Math.min(height-h,y+(y-py)/elapsed*horizon));
  return {...d,box:[nx,ny,w,h]};
}
