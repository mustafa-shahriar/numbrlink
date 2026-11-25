/**
 * Deterministic board generation shared by the browser and the room server.
 *
 * @typedef {{ x: number, y: number, size: number }} BoardNode
 */

export const TOTAL_NUMBERS = 15

/** Small, fast, deterministic PRNG so every player sees an identical board. */
export function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Scatter `count` numbered nodes with a minimum spacing.
 * The same seed always produces the same board.
 *
 * @param {number} seed
 * @param {number} [count]
 * @returns {BoardNode[]}
 */
export function generateBoard(seed, count = TOTAL_NUMBERS) {
  const rand = mulberry32(seed)
  /** @type {BoardNode[]} */
  const nodes = []

  let attempts = 0
  while (nodes.length < count && attempts < 30_000) {
    attempts++
    // Relax the spacing a little if we're struggling to fit them all.
    const minDist = attempts > 12_000 ? 0.12 : 0.158
    const x = 0.085 + rand() * 0.83
    const y = 0.085 + rand() * 0.83
    const fits = nodes.every((n) => Math.hypot(n.x - x, n.y - y) > minDist)
    if (fits) {
      nodes.push({
        x,
        y,
        size: 0.86 + rand() * 0.32,
      })
    }
  }

  // Practically unreachable fallback so the board is always complete.
  while (nodes.length < count) {
    const angle = (nodes.length / count) * Math.PI * 2
    nodes.push({
      x: 0.5 + Math.cos(angle) * 0.38,
      y: 0.5 + Math.sin(angle) * 0.38,
      size: 1,
    })
  }

  return nodes
}
