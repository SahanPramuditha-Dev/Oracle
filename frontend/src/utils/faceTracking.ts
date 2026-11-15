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
  score_margin?: number | null;
  possible_match?: string | null;
  public_figure?: { id: string; name: string; source: string } | null;
  box: [number,number,number,number];
  trackId?: number;
  lastSeen?: number;
  held?: boolean;
  quality?: { detection_score?: number };
}
interface Track { face: FaceObservation; displayBox: FaceObservation['box']; hits: number; observations: number; unknownHits: number; seen: number; trackId: number }
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
      const unknownHits = face.recognition_state === 'unknown' ? (previous?.unknownHits ?? 0) + 1 : 0;
      const identityChanged = previous?.face.id !== face.id;
      const displayBox = previous && !identityChanged
        ? face.box.map((value, index) => {
          const old = previous.displayBox[index];
          const weight = Math.abs(value - old) <= Math.max(face.box[2], face.box[3]) * .15 ? .45 : 1;
          return old + (value - old) * weight;
        }) as FaceObservation['box']
        : face.box;
      next.push({face,displayBox,hits,observations,unknownHits,seen:now,trackId});
      // Unknown detections must persist across consecutive reads before display.
      if (!face.matched && (observations < 3 || (face.recognition_state === 'unknown' && unknownHits < 3))) return [];
      return [{...face,box:displayBox,trackId,lastSeen:now,matched:face.matched && hits>=2,
        recognition_state:face.matched && hits<2 ? 'confirming' : face.recognition_state,
        name:face.matched && hits<2 ? 'Confirming identity' : face.name,
        possible_match: face.possible_match || null,
        public_figure: face.public_figure?.id === previous?.face.public_figure?.id ? face.public_figure : null}];
    });
    const held = faces.length === 0 ? this.tracks.filter(track =>
      track.hits >= 2 && now - track.seen <= 450
    ) : [];
    this.tracks = next;
    if (held.length) return held.map(track => ({
      ...track.face, box: track.displayBox, trackId: track.trackId, lastSeen: track.seen, held: true,
    }));
    return output;
  }
}
