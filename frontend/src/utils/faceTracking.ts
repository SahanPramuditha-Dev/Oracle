export interface FaceObservation {
  id: string | null;
  name: string;
  matched: boolean;
  recognition_state: string;
  cosine_score: number | null;
  permission?: string | null;
  relationship?: string | null;
  notes?: string;
  reason?: string | null;
  box: [number,number,number,number];
  trackId?: number;
  quality?: { detection_score?: number };
}
interface Track { face: FaceObservation; hits: number; observations: number; seen: number; trackId: number }
export class FaceConfirmation {
  private tracks: Track[] = [];
  private nextId = 1;
  reset() { this.tracks = []; }
  update(faces: FaceObservation[], now: number): FaceObservation[] {
    const available = new Set(this.tracks.filter(t => now-t.seen<=6000));
    const next: Track[] = [];
    const output = faces.filter(face => {
      const [x,y,w,h] = face.box;
      const score = face.quality?.detection_score;
      return [x,y,w,h].every(Number.isFinite) && w > 0 && h > 0 && (score === undefined || (Number.isFinite(score) && score >= .85));
    }).flatMap(face => {
      const ranked = [...available].map(t => {
        const [x,y,w,h] = face.box, [a,b,c,d] = t.face.box;
        const overlap=Math.max(0,Math.min(x+w,a+c)-Math.max(x,a))*Math.max(0,Math.min(y+h,b+d)-Math.max(y,b));
        return {t, iou:overlap/(w*h+c*d-overlap)};
      }).filter(x => x.iou>=.3).sort((a,b) => b.iou-a.iou);
      const previous = ranked.length && (ranked.length===1 || ranked[0].iou-ranked[1].iou>=.1) ? ranked[0].t : undefined;
      if(previous) available.delete(previous);
      const hits = face.matched && face.id ? (previous?.face.matched && previous.face.id===face.id ? previous.hits+1 : 1) : 0;
      const trackId = previous?.trackId ?? this.nextId++;
      const observations = (previous?.observations ?? 0) + 1;
      next.push({face,hits,observations,seen:now,trackId});
      // Unknown detections must persist across consecutive reads before display.
      if (!face.matched && observations < 3) return [];
      return [{...face,trackId,matched:face.matched && hits>=2,
        recognition_state:face.matched && hits<2 ? 'confirming' : face.recognition_state,
        name:face.matched && hits<2 ? 'Confirming identity' : face.name}];
    });
    this.tracks = next;
    return output;
  }
}
