// Wände = Linien/Pfade auf dem FOG-Layer (wie bei Dynamic Fog).
let segments = [];

function toWorld(item, p) {
  const s = item.scale ?? { x: 1, y: 1 };
  const r = ((item.rotation ?? 0) * Math.PI) / 180;
  const x = p.x * s.x, y = p.y * s.y;
  return {
    x: item.position.x + x * Math.cos(r) - y * Math.sin(r),
    y: item.position.y + x * Math.sin(r) + y * Math.cos(r),
  };
}

function itemSegments(item) {
  const pts = [];
  let closed = false;
  if (item.type === "LINE") {
    pts.push([toWorld(item, item.startPosition), toWorld(item, item.endPosition)]);
  } else if (item.type === "CURVE") {
    pts.push(item.points.map((p) => toWorld(item, p)));
    closed = !!item.closed;
  } else if (item.type === "PATH") {
    // Befehle: 0 MOVE, 1 LINE, 2 QUAD, 3 CONIC, 4 CUBIC, 5 CLOSE – Kurven werden auf den Endpunkt reduziert
    let cur = null;
    for (const c of item.commands) {
      if (c[0] === 0) { cur = [toWorld(item, { x: c[1], y: c[2] })]; pts.push(cur); }
      else if (c[0] === 5) { if (cur) cur.push(cur[0]); }
      else if (cur) {
        const n = c.length;
        cur.push(toWorld(item, { x: c[n - 2], y: c[n - 1] }));
      }
    }
  }
  const out = [];
  for (const poly of pts) {
    for (let i = 0; i < poly.length - 1; i++) out.push([poly[i], poly[i + 1]]);
    if (closed && poly.length > 2) out.push([poly[poly.length - 1], poly[0]]);
  }
  return out;
}

export function setWalls(items) {
  segments = items.filter((i) => i.layer === "FOG").flatMap(itemSegments);
}

const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function intersects(p1, p2, q1, q2) {
  const d1 = cross(q1, q2, p1), d2 = cross(q1, q2, p2);
  const d3 = cross(p1, p2, q1), d4 = cross(p1, p2, q2);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

export function blocked(from, to) {
  return segments.some(([a, b]) => intersects(from, to, a, b));
}
