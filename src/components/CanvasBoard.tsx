import { createEffect, createMemo, onCleanup, onMount } from 'solid-js'
import type { BoardNode } from '../game/board'
import { MAX_POINTS, TURN_MS, checkSegment, nodeRadius, type Point } from '../game/rules'

type LinkShape = { by: string; points: Point[] }

/** The stroke that eliminated a player, kept on screen after the match ends. */
export type FatalView = {
  path: Point[] | null
  at: Point | null
  label: string
  from: number | null
  to: number | null
}

type Props = {
  seed: number
  nodes: BoardNode[]
  links: LinkShape[]
  linkIndex: number
  status: 'lobby' | 'countdown' | 'playing' | 'done'
  enabled: boolean
  deadline: number
  turnId: string | null
  turnColor: string
  myColor: string
  colorOf: (playerId: string) => string
  fatal?: FatalView | null
  onCommit: (path: Point[]) => void
  onBadStart: () => void
}

const TAU = Math.PI * 2

function trace(points: Point[]) {
  const path = new Path2D()
  if (points.length === 0) return path
  path.moveTo(points[0].x * 1000, points[0].y * 1000)
  for (let i = 1; i < points.length; i++) {
    path.lineTo(points[i].x * 1000, points[i].y * 1000)
  }
  return path
}

function perpendicularDistance(point: Point, a: Point, b: Point) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy)
  if (length === 0) return Math.hypot(point.x - a.x, point.y - a.y)
  return Math.abs(dx * (a.y - point.y) - dy * (a.x - point.x)) / length
}

function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points.slice()
  let maxDistance = 0
  let index = 0
  const first = points[0]
  const last = points[points.length - 1]
  for (let i = 1; i < points.length - 1; i++) {
    const distance = perpendicularDistance(points[i], first, last)
    if (distance > maxDistance) {
      maxDistance = distance
      index = i
    }
  }
  if (maxDistance > tolerance) {
    const left = simplify(points.slice(0, index + 1), tolerance)
    const right = simplify(points.slice(index), tolerance)
    return left.slice(0, -1).concat(right)
  }
  return [first, last]
}

function compact(points: Point[]): Point[] {
  const tolerances = [0.0016, 0.0025, 0.004, 0.006, 0.009, 0.014]
  let result = points
  for (const tolerance of tolerances) {
    result = simplify(points, tolerance)
    if (result.length <= MAX_POINTS) return result
  }
  // Extremely long scribble: fall back to an even sampling that keeps both ends.
  const step = (points.length - 1) / (MAX_POINTS - 1)
  const sampled: Point[] = []
  for (let i = 0; i < MAX_POINTS; i++) {
    sampled.push(points[Math.round(i * step)])
  }
  return sampled
}

export default function CanvasBoard(props: Props) {
  let canvas: HTMLCanvasElement | undefined
  let context: CanvasRenderingContext2D | null = null
  let background: HTMLCanvasElement | null = null
  let frame = 0
  let cssSize = 0

  const linkPaths = createMemo(() =>
    props.links.map((link) => ({ path: trace(link.points), color: props.colorOf(link.by) })),
  )

  const linkPoints = createMemo(() => props.links.map((link) => link.points))

  const fatalPath = createMemo(() =>
    props.fatal?.path && props.fatal.path.length > 1 ? trace(props.fatal.path) : null,
  )

  const nodePoints = createMemo(() =>
    props.nodes.map((node) => ({
      node,
      x: node.x * 1000,
      y: node.y * 1000,
      r: nodeRadius(node) * 1000,
    })),
  )

  // Interaction state is intentionally non-reactive: the animation loop reads it.
  let stroke: Point[] | null = null
  let strokeFatal: string | null = null
  let pending: Point[] | null = null
  let pendingFatal: string | null = null
  let awaiting = false
  let pointerId: number | null = null
  let commitTimer: ReturnType<typeof setTimeout> | undefined
  let fallbackTimer: ReturnType<typeof setTimeout> | undefined
  let lastKey = ''

  function resetInteraction() {
    stroke = null
    strokeFatal = null
    pending = null
    pendingFatal = null
    awaiting = false
    pointerId = null
    clearTimeout(commitTimer)
    clearTimeout(fallbackTimer)
  }

  createEffect(() => {
    const key = `${props.seed}|${props.turnId}|${props.linkIndex}|${props.status}|${props.enabled}`
    if (key === lastKey) return
    lastKey = key
    resetInteraction()
  })

  function drawBackground() {
    if (!canvas || !context) return
    const size = canvas.width
    if (size <= 0) return
    background = document.createElement('canvas')
    background.width = size
    background.height = size
    const bg = background.getContext('2d')
    if (!bg) return
    const scale = size / 1000
    bg.setTransform(scale, 0, 0, scale, 0, 0)

    const glow = bg.createRadialGradient(500, 460, 40, 500, 460, 640)
    glow.addColorStop(0, 'rgba(94, 242, 192, 0.075)')
    glow.addColorStop(0.55, 'rgba(167, 139, 250, 0.035)')
    glow.addColorStop(1, 'rgba(0, 0, 0, 0)')
    bg.fillStyle = glow
    bg.fillRect(0, 0, 1000, 1000)

    bg.fillStyle = 'rgba(255, 255, 255, 0.055)'
    for (let x = 21; x < 1000; x += 42) {
      for (let y = 21; y < 1000; y += 42) {
        bg.beginPath()
        bg.arc(x, y, 1.5, 0, TAU)
        bg.fill()
      }
    }
  }

  function resize() {
    if (!canvas) return
    const rect = canvas.getBoundingClientRect()
    const width = Math.max(1, Math.round(rect.width))
    const ratio = Math.min(window.devicePixelRatio || 1, 2)
    canvas.width = Math.round(width * ratio)
    canvas.height = canvas.width
    cssSize = width
    drawBackground()
  }

  onMount(() => {
    context = canvas?.getContext('2d') ?? null
    const observer = new ResizeObserver(() => resize())
    if (canvas) observer.observe(canvas)
    resize()

    const loop = () => {
      frame = requestAnimationFrame(loop)
      render()
    }
    frame = requestAnimationFrame(loop)

    onCleanup(() => {
      observer.disconnect()
      cancelAnimationFrame(frame)
      clearTimeout(commitTimer)
      clearTimeout(fallbackTimer)
    })
  })

  function toUnit(event: PointerEvent): Point {
    const rect = canvas!.getBoundingClientRect()
    return {
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    }
  }

  function commitStroke() {
    clearTimeout(commitTimer)
    if (!stroke) return
    const raw = stroke
    const fatal = strokeFatal
    stroke = null
    strokeFatal = null
    if (raw.length < 2) return

    const points = compact(raw)
    pending = points
    pendingFatal = fatal
    awaiting = true
    props.onCommit(points)

    clearTimeout(fallbackTimer)
    fallbackTimer = setTimeout(() => {
      awaiting = false
      pending = null
      pendingFatal = null
    }, 4000)
  }

  function scheduleCommit() {
    clearTimeout(commitTimer)
    commitTimer = setTimeout(commitStroke, 220)
  }

  function handleDown(event: PointerEvent & { currentTarget: HTMLCanvasElement }) {
    if (!props.enabled || awaiting || stroke) return
    if (props.deadline && Date.now() > props.deadline) return
    const point = toUnit(event)
    const node = props.nodes[props.linkIndex]
    if (!node) return
    if (Math.hypot(point.x - node.x, point.y - node.y) > nodeRadius(node) * 2.1) {
      props.onBadStart()
      return
    }
    event.preventDefault()
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* ignore */
    }
    pointerId = event.pointerId
    stroke = [point]
    strokeFatal = null
    pending = null
    pendingFatal = null
  }

  function handleMove(event: PointerEvent) {
    if (!stroke || event.pointerId !== pointerId) return
    event.preventDefault()
    if (strokeFatal) return
    if (props.deadline && Date.now() > props.deadline) {
      strokeFatal = 'timeout'
      scheduleCommit()
      return
    }

    const point = toUnit(event)
    const last = stroke[stroke.length - 1]
    if (Math.hypot(point.x - last.x, point.y - last.y) < 0.0035) return
    stroke.push(point)

    const hit = checkSegment({
      nodes: props.nodes,
      links: linkPoints(),
      linkIndex: props.linkIndex,
      a: last,
      b: point,
    })
    if (hit) {
      strokeFatal = hit.reason
      scheduleCommit()
    }
  }

  function releasePointer(event: PointerEvent & { currentTarget: HTMLCanvasElement }) {
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
    } catch {
      /* ignore */
    }
  }

  function handleUp(event: PointerEvent & { currentTarget: HTMLCanvasElement }) {
    if (!stroke || event.pointerId !== pointerId) return
    const point = toUnit(event)
    const last = stroke[stroke.length - 1]
    if (Math.hypot(point.x - last.x, point.y - last.y) > 0.0005) stroke.push(point)
    releasePointer(event)
    commitStroke()
  }

  function handleCancel(event: PointerEvent & { currentTarget: HTMLCanvasElement }) {
    if (event.pointerId !== pointerId) return
    releasePointer(event)
    // A cancelled pointer (system gesture, tab switch) shouldn't cost a life.
    stroke = null
    strokeFatal = null
    pointerId = null
    clearTimeout(commitTimer)
  }

  function render() {
    if (!context || !canvas || cssSize <= 0) return
    const now = Date.now()
    const size = canvas.width
    const unit = size / 1000

    context.setTransform(1, 0, 0, 1, 0, 0)
    context.clearRect(0, 0, size, size)
    if (background) context.drawImage(background, 0, 0)
    context.setTransform(unit, 0, 0, unit, 0, 0)

    context.lineCap = 'round'
    context.lineJoin = 'round'

    const paths = linkPaths()
    // Soft neon glow underneath every stroke.
    context.globalAlpha = 0.16
    for (const item of paths) {
      context.strokeStyle = item.color
      context.lineWidth = 26
      context.shadowColor = item.color
      context.shadowBlur = 22
      context.stroke(item.path)
    }
    // Crisp core on top.
    context.globalAlpha = 0.95
    for (const item of paths) {
      context.strokeStyle = item.color
      context.lineWidth = 6
      context.shadowBlur = 5
      context.stroke(item.path)
    }
    context.globalAlpha = 1
    context.shadowBlur = 0

    const failed = props.status === 'done' ? (props.fatal ?? null) : null

    // The stroke that ended the run stays on the board, dashed and red.
    if (failed) {
      const deadPath = fatalPath()
      if (deadPath) {
        context.save()
        context.setLineDash([16, 13])
        context.globalAlpha = 0.22
        context.strokeStyle = '#ff6478'
        context.lineWidth = 26
        context.shadowColor = '#ff6478'
        context.shadowBlur = 26
        context.stroke(deadPath)
        context.globalAlpha = 0.95
        context.lineWidth = 6
        context.shadowBlur = 10
        context.stroke(deadPath)
        context.restore()
      }
    }

    const live = stroke ?? pending
    if (live && live.length > 1) {
      const fatal = stroke ? strokeFatal : pendingFatal
      const color = fatal ? '#ff6478' : props.myColor
      const path = trace(live)
      context.globalAlpha = 0.2
      context.strokeStyle = color
      context.lineWidth = 26
      context.shadowColor = color
      context.shadowBlur = 24
      context.stroke(path)

      context.globalAlpha = 0.95
      context.lineWidth = 6
      context.shadowBlur = 8
      context.stroke(path)

      context.globalAlpha = 1
      context.shadowBlur = 0
      const head = live[live.length - 1]
      context.beginPath()
      context.arc(head.x * 1000, head.y * 1000, 6, 0, TAU)
      context.fillStyle = color
      context.fill()
    }

    const linkIndex = props.linkIndex
    const complete = linkIndex >= props.nodes.length - 1
    const playing = props.status === 'playing'
    const pulse = 0.5 + 0.5 * Math.sin(now / 320)

    for (let i = 0; i < nodePoints().length; i++) {
      const item = nodePoints()[i]
      const isDone = complete || i < linkIndex
      const isStart = !complete && i === linkIndex
      const isTarget = !complete && i === linkIndex + 1
      const { x, y, r } = item

      if (isDone) {
        const fill = context.createRadialGradient(x, y - r * 0.4, r * 0.15, x, y, r)
        fill.addColorStop(0, 'rgba(146, 252, 214, 0.95)')
        fill.addColorStop(1, 'rgba(94, 242, 192, 0.62)')
        context.beginPath()
        context.arc(x, y, r, 0, TAU)
        context.fillStyle = fill
        context.fill()
        context.lineWidth = 2
        context.strokeStyle = 'rgba(255, 255, 255, 0.5)'
        context.stroke()
      } else {
        context.beginPath()
        context.arc(x, y, r, 0, TAU)
        context.fillStyle = '#12161f'
        context.fill()
        context.lineWidth = 2.5
        context.strokeStyle = 'rgba(255, 255, 255, 0.14)'
        context.stroke()
      }

      if (isStart && playing) {
        context.beginPath()
        context.arc(x, y, r + 6, 0, TAU)
        context.strokeStyle = props.turnColor
        context.lineWidth = 3
        context.shadowColor = props.turnColor
        context.shadowBlur = 14 + pulse * 8
        context.stroke()
        context.shadowBlur = 0
      }

      if (isTarget && playing) {
        context.beginPath()
        context.arc(x, y, r + 7 + pulse * 4, 0, TAU)
        context.globalAlpha = 0.35 + pulse * 0.45
        context.strokeStyle = '#eafff7'
        context.lineWidth = 2.5
        context.stroke()
        context.globalAlpha = 1

        if (props.enabled && props.deadline) {
          const fraction = Math.max(0, Math.min(1, (props.deadline - now) / TURN_MS))
          context.beginPath()
          context.arc(x, y, r + 16, 0, TAU)
          context.strokeStyle = 'rgba(255, 255, 255, 0.1)'
          context.lineWidth = 3
          context.stroke()
          context.beginPath()
          context.arc(x, y, r + 16, -Math.PI / 2, -Math.PI / 2 + fraction * TAU)
          context.strokeStyle = fraction < 0.25 ? '#ff6478' : '#5ef2c0'
          context.lineWidth = 3
          context.stroke()
        }
      }

      if (failed && (failed.from === i + 1 || failed.to === i + 1)) {
        context.save()
        context.beginPath()
        context.arc(x, y, r + 10, 0, TAU)
        context.setLineDash([9, 9])
        context.strokeStyle = 'rgba(255, 100, 120, 0.85)'
        context.lineWidth = 3
        context.stroke()
        context.restore()
      }

      context.fillStyle = isDone ? '#05231a' : '#dbe2f2'
      context.font = `700 ${Math.round(33 * item.node.size)}px "JetBrains Mono", ui-monospace, monospace`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(String(i + 1), x, y + 1)
    }

    if (failed?.at) {
      const x = failed.at.x * 1000
      const y = failed.at.y * 1000
      const beat = 0.5 + 0.5 * Math.sin(now / 240)
      // Keep the marker and label readable at any board size: size in CSS pixels,
      // then convert to the canvas' 1000-unit space.
      const toUnits = (css: number) => (css * 1000) / cssSize

      context.save()
      // Expanding pulse ring.
      context.beginPath()
      context.arc(x, y, toUnits(15 + beat * 9), 0, TAU)
      context.strokeStyle = `rgba(255, 100, 120, ${0.5 - beat * 0.24})`
      context.lineWidth = toUnits(2)
      context.stroke()

      // Solid hit marker with a cross.
      context.beginPath()
      context.arc(x, y, toUnits(9), 0, TAU)
      context.fillStyle = 'rgba(255, 100, 120, 0.16)'
      context.fill()
      context.strokeStyle = '#ff6478'
      context.lineWidth = toUnits(2.5)
      context.stroke()

      const cross = toUnits(4.5)
      context.beginPath()
      context.moveTo(x - cross, y - cross)
      context.lineTo(x + cross, y + cross)
      context.moveTo(x + cross, y - cross)
      context.lineTo(x - cross, y + cross)
      context.lineWidth = toUnits(3)
      context.stroke()

      // Reason label, clamped to stay on the board.
      const label = failed.label
      const fontPx = toUnits(12.5)
      const fontFamily = '"Space Grotesk", "Segoe UI", system-ui, sans-serif'
      context.font = `600 ${fontPx}px ${fontFamily}`
      const pad = toUnits(10)
      const pillW = Math.min(context.measureText(label).width + pad * 2, 940)
      const pillH = fontPx * 1.9
      const gap = toUnits(13)
      let px = x + gap
      if (px + pillW > 980) px = x - gap - pillW
      px = Math.max(toUnits(4), Math.min(px, 1000 - toUnits(4) - pillW))
      const py = Math.max(toUnits(3), Math.min(y - pillH / 2, 1000 - toUnits(3) - pillH))

      context.beginPath()
      context.moveTo(x + (px > x ? toUnits(10) : -toUnits(10)), y)
      context.lineTo(px > x ? px : px + pillW, y)
      context.strokeStyle = 'rgba(255, 100, 120, 0.35)'
      context.lineWidth = toUnits(1.5)
      context.stroke()

      context.beginPath()
      if (typeof context.roundRect === 'function') {
        context.roundRect(px, py, pillW, pillH, toUnits(7))
      } else {
        context.rect(px, py, pillW, pillH)
      }
      context.fillStyle = 'rgba(28, 10, 15, 0.92)'
      context.fill()
      context.strokeStyle = 'rgba(255, 100, 120, 0.5)'
      context.lineWidth = toUnits(1.5)
      context.stroke()

      context.fillStyle = '#ffb3bd'
      context.font = `600 ${fontPx}px ${fontFamily}`
      context.textAlign = 'center'
      context.textBaseline = 'middle'
      context.fillText(label, px + pillW / 2, py + pillH / 2 + toUnits(1))
      context.restore()
    }
  }

  const labelIndex = () => Math.min(props.linkIndex + 1, props.nodes.length)

  return (
    <canvas
      ref={(element) => (canvas = element)}
      class="board-canvas"
      role="application"
      aria-label={`Number board: connect ${labelIndex()} to ${Math.min(labelIndex() + 1, 15)} without crossing a line`}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleCancel}
    />
  )
}
