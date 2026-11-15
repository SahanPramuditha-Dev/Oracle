interface Observation {
  faces_detected: number;
  identified?: {id?: string; matched?: boolean; permission?: string; cosine_score?: number; threshold?: number; recognition_state?: string}[];
}

// Recognition is presentation metadata, not proof of liveness or authorization.
export class FaceIdentityGate {
  private id: string | null = null;
  private hits = 0;
  reset() { this.id = null; this.hits = 0; }
  observe(data: Observation): boolean {
    const face = data.identified?.[0];
    if (data.faces_detected !== 1 || data.identified?.length !== 1 || !face?.matched || !face.id ||
        face.recognition_state !== 'recognized' ||
        !['standard', 'administrator'].includes(face.permission || '') ||
        !Number.isFinite(face.cosine_score) || face.cosine_score! < Math.max(0.45, face.threshold || 0)) {
      this.reset();
      return false;
    }
    this.hits = this.id === face.id ? this.hits + 1 : 1;
    this.id = face.id;
    return this.hits >= 3;
  }
}
