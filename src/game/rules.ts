import {
  checkSegment as checkSegmentRaw,
  validateLink as validateLinkRaw,
} from '../../shared/rules.js'
import type { BoardNode } from './board'

export {
  COUNTDOWN_MS,
  EDGE_PAD,
  MAX_POINTS,
  NODE_BASE_RADIUS,
  STROKE_CLEARANCE,
  TURN_MS,
  distance,
  nodeRadius,
} from '../../shared/rules.js'

export type Point = { x: number; y: number }

/** Reasons a stroke can be rejected. */
export type LinkFailure =
  | 'too-short'
  | 'too-long'
  | 'bad-path'
  | 'no-target'
  | 'not-at-start'
  | 'not-at-target'
  | 'left-board'
  | 'crossed-line'
  | 'timeout'
  | 'left'
  | 'disconnected'

export type SegmentHit = {
  reason: LinkFailure
  number?: number
  at?: Point
} | null

export type Validation = { ok: true } | { ok: false; reason: LinkFailure; number?: number; at?: Point }

export function checkSegment(args: {
  nodes: BoardNode[]
  links: Point[][]
  linkIndex: number
  a: Point
  b: Point
}): SegmentHit {
  return checkSegmentRaw(args) as SegmentHit
}

export function validateLink(args: {
  nodes: BoardNode[]
  links: Point[][]
  linkIndex: number
  path: Point[]
}): Validation {
  return validateLinkRaw(args) as Validation
}

const REASON_TEXT: Record<LinkFailure, string> = {
  'too-short': 'let go without drawing',
  'too-long': 'scribbled too far',
  'bad-path': 'sent a broken stroke',
  'no-target': 'ran out of numbers',
  'not-at-start': 'started off the current number',
  'not-at-target': 'let go before the next number',
  'left-board': 'left the board',
  'crossed-line': 'crossed a line',
  timeout: 'ran out of time',
  left: 'left the match',
  disconnected: 'disconnected',
}

export function reasonText(reason: string | null | undefined): string {
  if (!reason) return ''
  return REASON_TEXT[reason as LinkFailure] ?? reason
}
