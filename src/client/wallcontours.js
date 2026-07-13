// Построение контуров стен из поля плотности (groundMap) методом marching
// squares. Чистая CPU-геометрия без WebGL: на входе поле, на выходе список
// сегментов { p0, p1, nx, nz, len } в мировых координатах.
//
// Конвейер: buildWallSegments -> mergeWallSegments -> splitLongWallSegments.

function sampleWallField(groundMap, mapCells, gx, gy) {
  if (gx < 0 || gy < 0 || gx >= mapCells || gy >= mapCells) return 0;
  return groundMap.getData(gx, gy);
}

function wallEdgePoint(mapScale, edge, gx, gy, v00, v10, v01, v11, iso = 0.5) {
  const wx = (coord) => coord / mapScale;
  const wz = (coord) => coord / mapScale;
  function lerpIso(va, vb, x0, z0, x1, z1) {
    const denom = vb - va;
    const t = Math.abs(denom) < 1e-6 ? 0.5 : (iso - va) / denom;
    return [x0 + (x1 - x0) * t, z0 + (z1 - z0) * t];
  }
  switch (edge) {
    case 0:
      return lerpIso(v00, v10, wx(gx), wz(gy), wx(gx + 1), wz(gy));
    case 1:
      return lerpIso(v10, v11, wx(gx + 1), wz(gy), wx(gx + 1), wz(gy + 1));
    case 2:
      return lerpIso(v01, v11, wx(gx), wz(gy + 1), wx(gx + 1), wz(gy + 1));
    case 3:
      return lerpIso(v00, v01, wx(gx), wz(gy), wx(gx), wz(gy + 1));
    default:
      return [wx(gx), wz(gy)];
  }
}

export function buildWallSegments(groundMap, mapCells, mapScale) {
  const wall_segments = [];
  const seen = new Set();
  const MS_SEGMENTS = [
    [],
    [[0, 3]],
    [[0, 1]],
    [[1, 3]],
    [[1, 2]],
    [
      [0, 1],
      [2, 3],
    ],
    [[0, 2]],
    [[2, 3]],
    [[2, 3]],
    [[0, 2]],
    [
      [0, 3],
      [1, 2],
    ],
    [[1, 2]],
    [[1, 3]],
    [[0, 1]],
    [[0, 3]],
    [],
  ];

  const sample = (gx, gy) => sampleWallField(groundMap, mapCells, gx, gy);

  function addWallSegment(p0, p1) {
    // Ключ из пары точек, инвариантный к порядку концов (A-B == B-A), но
    // различающий РАЗНЫЕ сегменты. Сортировка 4 координат по отдельности
    // схлопывала бы разные сегменты с одинаковым набором координат
    // (напр. (0,0)-(1,2) и (1,0)-(0,2)) — отсюда дыры в стенах.
    const ka = p0[0].toFixed(4) + ',' + p0[1].toFixed(4);
    const kb = p1[0].toFixed(4) + ',' + p1[1].toFixed(4);
    const key = ka < kb ? ka + '|' + kb : kb + '|' + ka;
    if (seen.has(key)) return;
    seen.add(key);

    const dx = p1[0] - p0[0];
    const dz = p1[1] - p0[1];
    const segLen = Math.hypot(dx, dz);
    if (segLen < 1e-5) return;

    let nx = -dz / segLen;
    let nz = dx / segLen;
    const midx = (p0[0] + p1[0]) * 0.5;
    const midz = (p0[1] + p1[1]) * 0.5;
    const probe = sample((midx + nx * 0.05) * mapScale, (midz + nz * 0.05) * mapScale);
    if (probe > 0.5) {
      nx = -nx;
      nz = -nz;
    }

    wall_segments.push({
      p0: [p0[0], p0[1]],
      p1: [p1[0], p1[1]],
      nx: nx,
      nz: nz,
      len: segLen,
    });
  }

  for (let gy = 0; gy < mapCells - 1; gy++) {
    for (let gx = 0; gx < mapCells - 1; gx++) {
      const v00 = sample(gx, gy);
      const v10 = sample(gx + 1, gy);
      const v01 = sample(gx, gy + 1);
      const v11 = sample(gx + 1, gy + 1);
      const caseIndex =
        (v00 > 0.5 ? 1 : 0) | (v10 > 0.5 ? 2 : 0) | (v11 > 0.5 ? 4 : 0) | (v01 > 0.5 ? 8 : 0);
      let edges = MS_SEGMENTS[caseIndex];
      // Седловые случаи MS (5 и 10): без disambiguation остаются дыры
      // в диагональных/тонких стенах.
      if (caseIndex === 5)
        edges =
          v00 + v11 > v10 + v01
            ? [
                [0, 1],
                [2, 3],
              ]
            : [
                [0, 3],
                [1, 2],
              ];
      else if (caseIndex === 10)
        edges =
          v00 + v11 > v10 + v01
            ? [
                [0, 3],
                [1, 2],
              ]
            : [
                [0, 1],
                [2, 3],
              ];
      if (!edges.length) continue;

      const pts = [
        wallEdgePoint(mapScale, 0, gx, gy, v00, v10, v01, v11),
        wallEdgePoint(mapScale, 1, gx, gy, v00, v10, v01, v11),
        wallEdgePoint(mapScale, 2, gx, gy, v00, v10, v01, v11),
        wallEdgePoint(mapScale, 3, gx, gy, v00, v10, v01, v11),
      ];
      for (let i = 0; i < edges.length; i++) {
        const e = edges[i];
        addWallSegment(pts[e[0]], pts[e[1]]);
      }
    }
  }

  return wall_segments;
}

// Сшиваем коллинеарные соединённые сегменты в длинные «прогоны»: прямая стена
// становится одним полигоном с непрерывной текстурой и одним атлас-тайлом, а
// декали переходят по всему прогону (рвутся лишь на реальных углах).
export function mergeWallSegments(segments) {
  const EPS_DIR = 0.9995; // cos порога коллинеарности (~1.8°)
  const keyOf = (p) => p[0].toFixed(4) + ',' + p[1].toFixed(4);

  const endpoints = new Map();
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const k0 = keyOf(s.p0),
      k1 = keyOf(s.p1);
    if (!endpoints.has(k0)) endpoints.set(k0, []);
    if (!endpoints.has(k1)) endpoints.set(k1, []);
    endpoints.get(k0).push({ idx: i, end: 0 });
    endpoints.get(k1).push({ idx: i, end: 1 });
  }

  const used = new Array(segments.length).fill(false);
  const merged = [];

  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const s = segments[i];
    const dir = [(s.p1[0] - s.p0[0]) / s.len, (s.p1[1] - s.p0[1]) / s.len];
    const nx = s.nx,
      nz = s.nz;
    let start = [s.p0[0], s.p0[1]];
    let end = [s.p1[0], s.p1[1]];

    // Расширяем вперёд от end вдоль dir.
    let grow = true;
    while (grow) {
      grow = false;
      const cands = endpoints.get(keyOf(end));
      if (!cands) break;
      for (let c = 0; c < cands.length; c++) {
        const cand = cands[c];
        if (used[cand.idx]) continue;
        const cs = segments[cand.idx];
        const far = cand.end === 0 ? cs.p1 : cs.p0;
        const cdir = [(far[0] - end[0]) / cs.len, (far[1] - end[1]) / cs.len];
        if (cdir[0] * dir[0] + cdir[1] * dir[1] < EPS_DIR) continue;
        if (cs.nx * nx + cs.nz * nz < EPS_DIR) continue;
        used[cand.idx] = true;
        end = [far[0], far[1]];
        grow = true;
        break;
      }
    }

    // Расширяем назад от start против dir.
    grow = true;
    while (grow) {
      grow = false;
      const cands = endpoints.get(keyOf(start));
      if (!cands) break;
      for (let c = 0; c < cands.length; c++) {
        const cand = cands[c];
        if (used[cand.idx]) continue;
        const cs = segments[cand.idx];
        const far = cand.end === 0 ? cs.p1 : cs.p0;
        const cdir = [(start[0] - far[0]) / cs.len, (start[1] - far[1]) / cs.len];
        if (cdir[0] * dir[0] + cdir[1] * dir[1] < EPS_DIR) continue;
        if (cs.nx * nx + cs.nz * nz < EPS_DIR) continue;
        used[cand.idx] = true;
        start = [far[0], far[1]];
        grow = true;
        break;
      }
    }

    const len = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (len < 1e-5) {
      merged.push({ p0: s.p0, p1: s.p1, nx: nx, nz: nz, len: s.len, mergedRunId: merged.length });
      continue;
    }
    merged.push({ p0: start, p1: end, nx: nx, nz: nz, len: len, mergedRunId: merged.length });
  }

  return merged;
}

// Длинные прогоны после merge могут не влезть в один тайл атласа — режем
// на куски до упаковки. uOffset сохраняет непрерывность текстуры вдоль стены.
export function splitLongWallSegments(segments, maxWorldLen) {
  const out = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.len <= maxWorldLen) {
      out.push(seg);
      continue;
    }
    const dx = (seg.p1[0] - seg.p0[0]) / seg.len;
    const dz = (seg.p1[1] - seg.p0[1]) / seg.len;
    let along = 0;
    while (along < seg.len - 1e-5) {
      const chunk = Math.min(maxWorldLen, seg.len - along);
      const ax = seg.p0[0] + dx * along;
      const az = seg.p0[1] + dz * along;
      const bx = seg.p0[0] + dx * (along + chunk);
      const bz = seg.p0[1] + dz * (along + chunk);
      out.push({
        p0: [ax, az],
        p1: [bx, bz],
        nx: seg.nx,
        nz: seg.nz,
        len: chunk,
        uOffset: along,
        mergedRunId: seg.mergedRunId,
      });
      along += chunk;
    }
  }
  return out;
}

// Стыкует uOffset вдоль коллинеарных сегментов, которые merge не склеил
// (тонкие стены, погрешность нормалей marching squares).
export function chainWallUStarts(segments) {
  const keyOf = (p) => p[0].toFixed(4) + ',' + p[1].toFixed(4);
  const COS = 0.9995;
  const at = new Map();

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    s._dir = [(s.p1[0] - s.p0[0]) / s.len, (s.p1[1] - s.p0[1]) / s.len];
    if (s.uOffset === undefined) s.uOffset = 0;
    for (const [k, end] of [
      [keyOf(s.p0), 0],
      [keyOf(s.p1), 1],
    ]) {
      if (!at.has(k)) at.set(k, []);
      at.get(k).push({ i, end });
    }
  }

  const extendFrom = (fromIdx, fromEnd, uNext) => {
    const s = segments[fromIdx];
    const key = keyOf(fromEnd === 1 ? s.p1 : s.p0);
    const list = at.get(key);
    if (!list) return;
    for (let c = 0; c < list.length; c++) {
      const { i, end } = list[c];
      if (i === fromIdx) continue;
      const o = segments[i];
      if (o._uvChained) continue;
      let outward;
      if (fromEnd === 1 && end === 0) outward = s._dir[0] * o._dir[0] + s._dir[1] * o._dir[1];
      else if (fromEnd === 0 && end === 1)
        outward = s._dir[0] * -o._dir[0] + s._dir[1] * -o._dir[1];
      else continue;
      if (outward < COS) continue;
      if (s.nx * o.nx + s.nz * o.nz < COS) continue;
      o.uOffset = uNext;
      o._uvChained = true;
      extendFrom(i, 1, uNext + o.len);
    }
  };

  for (let i = 0; i < segments.length; i++) {
    if (segments[i]._uvChained) continue;
    segments[i]._uvChained = true;
    extendFrom(i, 1, segments[i].uOffset + segments[i].len);
  }

  for (let i = 0; i < segments.length; i++) {
    delete segments[i]._dir;
    delete segments[i]._uvChained;
  }
}

const EP_SNAP = 8192;

export function snapWallPoint(p) {
  return [Math.round(p[0] * EP_SNAP) / EP_SNAP, Math.round(p[1] * EP_SNAP) / EP_SNAP];
}

export function wallEpKey(p) {
  const s = snapWallPoint(p);
  return s[0].toFixed(4) + ',' + s[1].toFixed(4);
}

// Связный список коллинеарных кусков одной стены — для атласа декалей и непрерывного UV.
export function linkColinearRuns(segments) {
  const EPS_DIR = 0.9995;
  const endpoints = new Map();
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    s.runNext = null;
    s.runPrev = null;
    for (const [end, pt] of [
      [0, s.p0],
      [1, s.p1],
    ]) {
      const k = wallEpKey(pt);
      if (!endpoints.has(k)) endpoints.set(k, []);
      endpoints.get(k).push({ idx: i, end });
    }
  }

  for (let i = 0; i < segments.length; i++) {
    const s = segments[i];
    const dir = [(s.p1[0] - s.p0[0]) / s.len, (s.p1[1] - s.p0[1]) / s.len];
    const cands = endpoints.get(wallEpKey(s.p1));
    if (!cands) continue;
    let best = null;
    let bestDot = EPS_DIR;
    for (let c = 0; c < cands.length; c++) {
      const cand = cands[c];
      if (cand.idx === i || cand.end !== 0) continue;
      const o = segments[cand.idx];
      const odir = [(o.p1[0] - o.p0[0]) / o.len, (o.p1[1] - o.p0[1]) / o.len];
      const dot = dir[0] * odir[0] + dir[1] * odir[1];
      if (dot > bestDot && o.nx * s.nx + o.nz * s.nz > EPS_DIR) {
        bestDot = dot;
        best = o;
      }
    }
    if (best && !best.runPrev) {
      s.runNext = best;
      best.runPrev = s;
    }
  }
}
