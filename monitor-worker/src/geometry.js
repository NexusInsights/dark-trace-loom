import { HttpError, number } from "./core.js";
function cross(a, b, c) { return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); }
function onSegment(point, a, b) { return Math.abs(cross(a, b, point)) < 1e-10 && point[0] >= Math.min(a[0], b[0]) - 1e-10 && point[0] <= Math.max(a[0], b[0]) + 1e-10 && point[1] >= Math.min(a[1], b[1]) - 1e-10 && point[1] <= Math.max(a[1], b[1]) + 1e-10; }
function intersects(a, b, c, d) {
  const ac = cross(a, b, c), ad = cross(a, b, d), ca = cross(c, d, a), cb = cross(c, d, b);
  return (ac * ad < 0 && ca * cb < 0) || onSegment(c, a, b) || onSegment(d, a, b) || onSegment(a, c, d) || onSegment(b, c, d);
}
export function validatePolygon(value) {
  if (!Array.isArray(value) || value.length < 3 || value.length > 101) throw new HttpError("polygon must contain 3–100 longitude/latitude vertices");
  let vertices = value.map(vertex => {
    if (!Array.isArray(vertex) || vertex.length !== 2 || vertex.some(coord => typeof coord !== "number")) throw new HttpError("Every polygon vertex must be [longitude,latitude] numbers");
    return [number(vertex[0], "polygon longitude", -180, 180), number(vertex[1], "polygon latitude", -89.9, 89.9)];
  });
  if (vertices.length > 3 && vertices[0][0] === vertices.at(-1)[0] && vertices[0][1] === vertices.at(-1)[1]) vertices = vertices.slice(0, -1);
  if (vertices.length > 100 || new Set(vertices.map(vertex => vertex.join(","))).size !== vertices.length) throw new HttpError("Polygon vertices must be distinct, except an optional closing vertex");
  const longitudeRange = Math.max(...vertices.map(v => v[0])) - Math.min(...vertices.map(v => v[0]));
  if (longitudeRange > 180) throw new HttpError("Antimeridian-spanning geofences are not supported; supply a local polygon");
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i], b = vertices[(i + 1) % vertices.length]; area += a[0] * b[1] - a[1] * b[0];
    for (let j = i + 1; j < vertices.length; j++) {
      if (j === i + 1 || (i === 0 && j === vertices.length - 1)) continue;
      if (intersects(a, b, vertices[j], vertices[(j + 1) % vertices.length])) throw new HttpError("Polygon edges must not self-intersect");
    }
  }
  if (Math.abs(area) < 1e-10) throw new HttpError("Polygon must have a nonzero area");
  return vertices;
}
export function pointInPolygon(longitude, latitude, polygon) {
  const point = [longitude, latitude]; let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if (onSegment(point, a, b)) return true;
    if ((a[1] > latitude) !== (b[1] > latitude) && longitude < (b[0] - a[0]) * (latitude - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
