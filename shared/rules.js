/**
 * Turn-based line rules shared by the browser (live feedback + solo mode) and
 * the room server (authoritative validation).
 *
 * The chain always grows in order: 1 → 2, 2 → 3, … 14 → 15. On your turn you
 * draw one freehand stroke from the current number to the next one. The stroke
 * must stay on the board, must not cross or hug an existing stroke, and must not
 * pass over any other number. One bad attempt and you are out.
 *
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ x: number, y: number, size: number }} BoardNode
 * @typedef {{ ok: true } | { ok: false, reason: string, number?: number, at?: Point }} Validation
 * @typedef {{ reason: string, number?: number, at?: Point } | null} SegmentHit
 */

/** Drawn node radius (normalized 0..1 units) for a `size: 1` node. */
export const NODE_BASE_RADIUS = 0.03
/** How close the stroke must start to the current number (× node radius). */
export const START_TOLERANCE = 1.55
/** How close the stroke must end to the next number (× node radius). */
export const TARGET_TOLERANCE = 1.55
/** Minimum distance between two stroke center lines. */
export const STROKE_CLEARANCE = 0.012
/** Hard cap on points accepted from a client per stroke. */
export const MAX_POINTS = 240
/** Maximum total stroke length (normalized units). */
export const MAX_PATH_LENGTH = 8
/** Strokes may overshoot the board edge by this much. */
export const EDGE_PAD = 0.02
/** Time each player gets for one stroke. */
export const TURN_MS = 20_000
/** Countdown before the first turn. */
export const COUNTDOWN_MS = 3_000

/**
 * @param {BoardNode} node
 * @returns {number}
 */
export function nodeRadius(node) {
  return NODE_BASE_RADIUS * (node.size ?? 1)
}

/**
 * @param {Point} a
 * @param {Point} b
 * @returns {number}
 */
export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

function orient(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
}

function onSegment(a, b, p) {
  const eps = 1e-9
  return (
    p.x >= Math.min(a.x, b.x) - eps &&
    p.x <= Math.max(a.x, b.x) + eps &&
    p.y >= Math.min(a.y, b.y) - eps &&
    p.y <= Math.max(a.y, b.y) + eps
  )
}

/**
 * @param {Point} a
 * @param {Point} b
 * @param {Point} c
 * @param {Point} d
 * @returns {Point | null}
 */
export function segmentIntersection(a, b, c, d) {
  const d1 = orient(c, d, a)
  const d2 = orient(c, d, b)
  const d3 = orient(a, b, c)
  const d4 = orient(a, b, d)
  const eps = 1e-12

  if (
    ((d1 > eps && d2 < -eps) || (d1 < -eps && d2 > eps)) &&
    ((d3 > eps && d4 < -eps) || (d3 < -eps && d4 > eps))
  ) {
    const t = d1 / (d1 - d2)
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
  }

  if (Math.abs(d1) <= eps && onSegment(c, d, a)) return { x: a.x, y: a.y }
  if (Math.abs(d2) <= eps && onSegment(c, d, b)) return { x: b.x, y: b.y }
  if (Math.abs(d3) <= eps && onSegment(a, b, c)) return { x: c.x, y: c.y }
  if (Math.abs(d4) <= eps && onSegment(a, b, d)) return { x: d.x, y: d.y }
  return null
}

/**
 * Closest point on segment `a`–`b` to point `p`.
 * @param {Point} p
 * @param {Point} a
 * @param {Point} b
 * @returns {Point}
 */
export function closestOnSegment(p, a, b) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { x: a.x, y: a.y }
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return { x: a.x + dx * t, y: a.y + dy * t }
}

/**
 * Closest pair of points between two segments.
 * @returns {{ old: Point, next: Point, dist: number }}
 */
function closestPair(a, b, c, d) {
  const hit = segmentIntersection(a, b, c, d)
  if (hit) return { old: hit, next: hit, dist: 0 }

  const candidates = [
    [closestOnSegment(a, c, d), a],
    [closestOnSegment(b, c, d), b],
    [c, closestOnSegment(c, a, b)],
    [d, closestOnSegment(d, a, b)],
  ]

  let best = { old: c, next: a, dist: Infinity }
  for (const [oldPoint, nextPoint] of candidates) {
    const dist = distance(oldPoint, nextPoint)
    if (dist < best.dist) best = { old: oldPoint, next: nextPoint, dist }
  }
  return best
}

/**
 * Check one freshly drawn stroke segment. Used by the canvas for live feedback
 * and by full-stroke validation.
 *
 * @param {{ nodes: BoardNode[], links?: Point[][], linkIndex: number, a: Point, b: Point }} args
 * @returns {SegmentHit}
 */
export function checkSegment({ nodes, links = [], linkIndex, a, b }) {
  if (!a || !b) return null
  for (const point of [a, b]) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return { reason: 'left-board', at: point }
    }
    if (
      point.x < -EDGE_PAD ||
      point.x > 1 + EDGE_PAD ||
      point.y < -EDGE_PAD ||
      point.y > 1 + EDGE_PAD
    ) {
      return { reason: 'left-board', at: point }
    }
  }

  const startNode = nodes[linkIndex]
  const targetNode = nodes[linkIndex + 1]

  for (const path of links) {
    for (let i = 1; i < path.length; i++) {
      const near = closestPair(a, b, path[i - 1], path[i])
      if (near.dist >= STROKE_CLEARANCE) continue

      // Lines legitimately meet inside the number they connect. Close calls
      // there are unavoidable, so ignore contact within those discs.
      if (startNode && distance(near.old, startNode) < nodeRadius(startNode) * 1.15) continue
      if (targetNode && distance(near.old, targetNode) < nodeRadius(targetNode) * 1.15) continue

      return { reason: 'crossed-line', at: near.old }
    }
  }

  return null
}

/**
 * Validate a complete stroke for the current link.
 *
 * @param {{ nodes: BoardNode[], links?: Point[][], linkIndex: number, path: Point[] }} args
 * @returns {Validation}
 */
export function validateLink({ nodes, links = [], linkIndex, path }) {
  if (!Array.isArray(path) || path.length < 2) return { ok: false, reason: 'too-short' }
  if (path.length > MAX_POINTS) return { ok: false, reason: 'too-long' }
  for (const point of path) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
      return { ok: false, reason: 'bad-path' }
    }
  }

  const startNode = nodes[linkIndex]
  const targetNode = nodes[linkIndex + 1]
  if (!startNode || !targetNode) return { ok: false, reason: 'no-target' }

  if (distance(path[0], startNode) > nodeRadius(startNode) * START_TOLERANCE) {
    return { ok: false, reason: 'not-at-start', number: linkIndex + 1 }
  }
  if (distance(path[path.length - 1], targetNode) > nodeRadius(targetNode) * TARGET_TOLERANCE) {
    return { ok: false, reason: 'not-at-target', number: linkIndex + 2 }
  }

  let length = 0
  for (let i = 1; i < path.length; i++) {
    length += distance(path[i - 1], path[i])
  }
  if (length > MAX_PATH_LENGTH) return { ok: false, reason: 'too-long' }

  for (let i = 1; i < path.length; i++) {
    const hit = checkSegment({ nodes, links, linkIndex, a: path[i - 1], b: path[i] })
    if (hit) return { ok: false, ...hit }
  }

  return { ok: true }
}
