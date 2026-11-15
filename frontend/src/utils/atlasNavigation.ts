export type RoutePoint = [number, number];

const radians = Math.PI / 180;
const metresPerDegree = 111195;
const longitudeDelta = (a: number, b: number) => ((a - b + 540) % 360) - 180;

export function buildRouteTrack(points: RoutePoint[]) {
  let total = 0;
  const segments = points.slice(1).map((end, index) => {
    const start = points[index];
    const longitudeScale = metresPerDegree * Math.cos((start[1] + end[1]) * radians / 2);
    const dx = longitudeDelta(end[0], start[0]) * longitudeScale;
    const dy = (end[1] - start[1]) * metresPerDegree;
    const length = Math.hypot(dx, dy);
    const segment = { start, longitudeScale, dx, dy, length, offset: total };
    total += length;
    return segment;
  });

  return {
    total,
    project(point: RoutePoint, after = 0) {
      let closest = { distance: Infinity, progress: 0 };
      for (const { start, longitudeScale, dx, dy, length, offset } of segments) {
        if (!length || offset + length < after) continue;
        const x = longitudeDelta(point[0], start[0]) * longitudeScale;
        const y = (point[1] - start[1]) * metresPerDegree;
        const fraction = Math.max(0, Math.min(1, (x * dx + y * dy) / length ** 2));
        const distance = Math.hypot(x - dx * fraction, y - dy * fraction);
        if (distance < closest.distance) closest = { distance, progress: offset + fraction * length };
      }
      return closest;
    },
  };
}
