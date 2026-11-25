import { generateBoard as generate } from '../../shared/board.js'

export type BoardNode = {
  /** Normalized 0..1 horizontal position. */
  x: number
  /** Normalized 0..1 vertical position. */
  y: number
  /** Relative node size (1 = default). */
  size: number
}

/** Deterministic board shared with the room server. */
export function generateBoard(seed: number, count = 15): BoardNode[] {
  return generate(seed, count)
}
