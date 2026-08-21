import { drag } from "d3-drag"
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force"
import type { SimulationNodeDatum } from "d3-force"
import { select } from "d3-selection"
import React, { useEffect, useMemo, useRef, useState } from "react"

import { SectionHeader } from "../ui/SectionHeader"

const NODE_CARD_W = 112
const NODE_CARD_H = 52
const NODE_COLLIDE_R = 58
const LINK_TRIM = 52

const EDGE_GRADIENT_START = "#d97706"
const EDGE_GRADIENT_END = "#0d9488"

function shortenLineSegment(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  insetStart: number,
  insetEnd: number
): { readonly x1: number; readonly y1: number; readonly x2: number; readonly y2: number } | undefined {
  const dx = x2 - x1
  const dy = y2 - y1
  const length = Math.hypot(dx, dy)

  if (length < insetStart + insetEnd + 4) {
    return undefined
  }

  const ux = dx / length
  const uy = dy / length

  return {
    x1: x1 + ux * insetStart,
    y1: y1 + uy * insetStart,
    x2: x2 - ux * insetEnd,
    y2: y2 - uy * insetEnd
  }
}

interface RelationListCharacter {
  readonly id: string
  readonly name: string
  readonly role?: string
  readonly uri: string
  readonly relations: readonly { readonly target: string; readonly type: string }[]
}

export interface RelationGraphInitialData {
  readonly title: string
  readonly characters: readonly RelationListCharacter[]
  readonly isStoryboardProject: boolean
}

interface GraphNode extends SimulationNodeDatum {
  readonly id: string
  readonly name: string
  readonly role?: string
  readonly uri: string
}

interface GraphLinkDatum {
  readonly source: string | GraphNode
  readonly target: string | GraphNode
  readonly type: string
}

function createRequestId(): string {
  return crypto.randomUUID()
}

export function RelationGraph({ initialData }: { readonly initialData: RelationGraphInitialData }): React.ReactElement {
  const vscodeApi = useMemo(() => window.acquireVsCodeApi?.(), [])
  const [data, setData] = useState(initialData)
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ width: 640, height: 480 })
  const nodesRef = useRef<GraphNode[]>([])
  const linksRef = useRef<GraphLinkDatum[]>([])
  const simulationRef = useRef<ReturnType<typeof forceSimulation<GraphNode>> | undefined>(undefined)
  const [, setRenderVersion] = useState(0)

  useEffect(() => {
    const handleMessage = (event: MessageEvent<{ readonly type?: string; readonly method?: string; readonly payload?: unknown }>): void => {
      if (event.data.type !== "event" || event.data.method !== "relations.listChanged") {
        return
      }

      setData(parseRelationGraphInitialData(event.data.payload))
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [])

  useEffect(() => {
    const element = containerRef.current
    if (!element) {
      return
    }

    const resizeObserver = new ResizeObserver(() => {
      const nextWidth = element.clientWidth
      const nextHeight = element.clientHeight

      if (nextWidth > 0 && nextHeight > 0) {
        setSize({ width: nextWidth, height: nextHeight })
      }
    })

    resizeObserver.observe(element)
    return () => resizeObserver.disconnect()
  }, [])

  useEffect(() => {
    simulationRef.current?.stop()
    simulationRef.current = undefined
    nodesRef.current = []
    linksRef.current = []

    if (!data.isStoryboardProject || data.characters.length === 0 || size.width < 48 || size.height < 48) {
      setRenderVersion((value) => value + 1)
      return
    }

    const idSet = new Set(data.characters.map((character) => character.id))
    const nodes: GraphNode[] = data.characters.map((character, index) => {
      const angle = (index / Math.max(data.characters.length, 1)) * Math.PI * 2
      return {
        id: character.id,
        name: character.name,
        ...(character.role === undefined ? {} : { role: character.role }),
        uri: character.uri,
        x: size.width / 2 + Math.cos(angle) * Math.min(size.width, size.height) * 0.2,
        y: size.height / 2 + Math.sin(angle) * Math.min(size.width, size.height) * 0.2
      }
    })

    const linkInputs: GraphLinkDatum[] = []
    for (const character of data.characters) {
      for (const relation of character.relations) {
        if (idSet.has(relation.target)) {
          linkInputs.push({ source: character.id, target: relation.target, type: relation.type })
        }
      }
    }

    const simulation = forceSimulation<GraphNode>(nodes)
      .force(
        "link",
        forceLink<GraphNode, GraphLinkDatum>(linkInputs)
          .id((node) => node.id)
          .distance(140)
      )
      .force("charge", forceManyBody<GraphNode>().strength(-320))
      .force("center", forceCenter(size.width / 2, size.height / 2))
      .force("collide", forceCollide<GraphNode>(NODE_COLLIDE_R))

    nodesRef.current = nodes
    linksRef.current = linkInputs
    simulationRef.current = simulation

    let scheduledFrame = 0
    const onTick = (): void => {
      if (scheduledFrame !== 0) {
        return
      }

      scheduledFrame = window.requestAnimationFrame(() => {
        scheduledFrame = 0
        setRenderVersion((value) => value + 1)
      })
    }

    simulation.on("tick", onTick)

    for (let index = 0; index < 24; index += 1) {
      simulation.tick()
    }

    setRenderVersion((value) => value + 1)

    let dragCleanup: (() => void) | undefined
    let dragFrameOuter = 0
    let dragFrameInner = 0

    dragFrameOuter = window.requestAnimationFrame(() => {
      dragFrameInner = window.requestAnimationFrame(() => {
        const svg = svgRef.current
        const activeSimulation = simulationRef.current

        if (!svg || !activeSimulation) {
          return
        }

        const nodeSelection = select(svg).selectAll<SVGGElement, GraphNode>("g.graph-node")

        if (nodeSelection.empty()) {
          return
        }

        const dragBehavior = drag<SVGGElement, GraphNode>()
          .on("start", (event, node) => {
            if (!event.active) {
              activeSimulation.alphaTarget(0.35).restart()
            }

            node.fx = node.x
            node.fy = node.y
          })
          .on("drag", (event, node) => {
            node.fx = event.x
            node.fy = event.y
          })
          .on("end", (event, node) => {
            if (!event.active) {
              activeSimulation.alphaTarget(0)
            }

            node.fx = null
            node.fy = null
          })

        nodeSelection.call(dragBehavior)
        dragCleanup = (): void => {
          nodeSelection.on(".drag", null)
        }
      })
    })

    return () => {
      simulation.on("tick", null)
      simulation.stop()
      if (scheduledFrame !== 0) {
        window.cancelAnimationFrame(scheduledFrame)
      }

      window.cancelAnimationFrame(dragFrameOuter)
      window.cancelAnimationFrame(dragFrameInner)
      dragCleanup?.()
    }
  }, [data, size.width, size.height])

  const openCard = (uri: string): void => {
    vscodeApi?.postMessage({
      protocolVersion: "1.0.0",
      type: "request",
      id: createRequestId(),
      method: "cards.open",
      payload: { uri }
    })
  }

  if (!data.isStoryboardProject) {
    return (
      <main className="flex min-h-screen flex-col gap-4 bg-sb-bg p-4">
        <SectionHeader
          eyebrow="Storyboard"
          title={data.title}
          description="Storyboard 프로젝트가 아닙니다. 워크스페이스에 프로젝트를 초기화한 뒤 다시 열어 주세요."
        />
      </main>
    )
  }

  if (data.characters.length === 0) {
    return (
      <main className="flex min-h-screen flex-col gap-4 bg-sb-bg p-4">
        <SectionHeader
          eyebrow="Storyboard"
          title={data.title}
          description="캐릭터 카드가 없습니다. 사이드바에서 캐릭터를 추가한 뒤 다시 열어 주세요."
        />
      </main>
    )
  }

  const nodes = nodesRef.current
  const links = linksRef.current
  const hasRenderableLinks = links.length > 0

  const halfW = NODE_CARD_W / 2
  const halfH = NODE_CARD_H / 2

  return (
    <main className="flex h-screen min-h-0 flex-col gap-3 bg-sb-bg p-3">
      <div className="shrink-0 rounded-xl border border-sb-border bg-sb-bg-sidebar p-4 shadow-cardRest">
        <SectionHeader
          eyebrow="Storyboard"
          title={data.title}
          description={
            <>
              <p className="m-0 text-sm leading-normal">
                노드를 드래그해 배치할 수 있습니다. 노드를 더블클릭하면 카드 편집기가 열립니다.
              </p>
              {!hasRenderableLinks ? (
                <p className="m-0 mt-2 text-sm text-sb-fg-muted">
                  서로를 가리키는 relations가 없거나 한 명뿐입니다. 캐릭터 카드의 relations에 다른 캐릭터 ID를 연결하면 선이 표시됩니다.
                </p>
              ) : null}
            </>
          }
        />
      </div>
      <div ref={containerRef} className="min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-sb-border bg-sb-bg-sidebar shadow-cardRest">
        <svg ref={svgRef} className="h-full w-full touch-none" role="img" aria-label="Character relation graph">
          <defs>
            <marker id="storyboard-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
              <path d="M 0 0 L 10 5 L 0 10 z" fill={EDGE_GRADIENT_END} opacity="0.85" />
            </marker>
            {links.map((link, index) => {
              const sourceNode = typeof link.source === "object" ? link.source : nodes.find((node) => node.id === link.source)
              const targetNode = typeof link.target === "object" ? link.target : nodes.find((node) => node.id === link.target)

              if (
                sourceNode == null ||
                targetNode == null ||
                sourceNode.x == null ||
                sourceNode.y == null ||
                targetNode.x == null ||
                targetNode.y == null
              ) {
                return null
              }

              const segment = shortenLineSegment(
                sourceNode.x,
                sourceNode.y,
                targetNode.x,
                targetNode.y,
                LINK_TRIM,
                LINK_TRIM
              )

              if (segment == null) {
                return null
              }

              return (
                <linearGradient
                  key={`link-grad-${index}`}
                  id={`storyboard-link-grad-${index}`}
                  gradientUnits="userSpaceOnUse"
                  x1={segment.x1}
                  y1={segment.y1}
                  x2={segment.x2}
                  y2={segment.y2}
                >
                  <stop offset="0%" stopColor={EDGE_GRADIENT_START} stopOpacity={0.95} />
                  <stop offset="100%" stopColor={EDGE_GRADIENT_END} stopOpacity={0.95} />
                </linearGradient>
              )
            })}
          </defs>
          {links.map((link, index) => {
            const sourceNode = typeof link.source === "object" ? link.source : nodes.find((node) => node.id === link.source)
            const targetNode = typeof link.target === "object" ? link.target : nodes.find((node) => node.id === link.target)

            if (
              sourceNode == null ||
              targetNode == null ||
              sourceNode.x == null ||
              sourceNode.y == null ||
              targetNode.x == null ||
              targetNode.y == null
            ) {
              return null
            }

            const segment = shortenLineSegment(
              sourceNode.x,
              sourceNode.y,
              targetNode.x,
              targetNode.y,
              LINK_TRIM,
              LINK_TRIM
            )

            if (segment == null) {
              return null
            }

            return (
              <line
                key={`link-${index}`}
                x1={segment.x1}
                y1={segment.y1}
                x2={segment.x2}
                y2={segment.y2}
                stroke={`url(#storyboard-link-grad-${index})`}
                strokeWidth={2}
                strokeLinecap="round"
                markerEnd="url(#storyboard-arrow)"
              />
            )
          })}
          {nodes.map((node) => {
            const x = node.x ?? 0
            const y = node.y ?? 0
            const displayName = node.name.length > 16 ? `${node.name.slice(0, 15)}…` : node.name
            const roleText = node.role && node.role.length > 0 ? (node.role.length > 18 ? `${node.role.slice(0, 17)}…` : node.role) : ""

            return (
              <g
                key={node.id}
                className="graph-node cursor-grab"
                transform={`translate(${x},${y})`}
                onDoubleClick={() => openCard(node.uri)}
              >
                <rect
                  x={-halfW}
                  y={-halfH}
                  width={NODE_CARD_W}
                  height={NODE_CARD_H}
                  rx={10}
                  ry={10}
                  fill="var(--vscode-editorWidget-background)"
                  stroke="var(--vscode-focusBorder)"
                  strokeWidth={1}
                  className="pointer-events-auto"
                />
                <text
                  className="pointer-events-none select-none"
                  x={0}
                  y={roleText ? -5 : 2}
                  textAnchor="middle"
                  fill="var(--vscode-foreground)"
                  fontSize={12}
                  fontWeight={600}
                >
                  {displayName}
                </text>
                {roleText ? (
                  <text
                    className="pointer-events-none select-none"
                    x={0}
                    y={10}
                    textAnchor="middle"
                    fill="var(--vscode-descriptionForeground)"
                    fontSize={10}
                  >
                    {roleText}
                  </text>
                ) : null}
              </g>
            )
          })}
        </svg>
      </div>
    </main>
  )
}

export function parseRelationGraphInitialData(value: unknown): RelationGraphInitialData {
  if (!isRelationGraphInitialData(value)) {
    return {
      title: "Character Relations",
      characters: [],
      isStoryboardProject: false
    }
  }

  return value
}

function isRelationGraphInitialData(value: unknown): value is RelationGraphInitialData {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Partial<RelationGraphInitialData>
  if (typeof candidate.title !== "string" || typeof candidate.isStoryboardProject !== "boolean" || !Array.isArray(candidate.characters)) {
    return false
  }

  return candidate.characters.every(isRelationListCharacter)
}

function isRelationListCharacter(value: unknown): value is RelationListCharacter {
  if (!value || typeof value !== "object") {
    return false
  }

  const candidate = value as Partial<RelationListCharacter>
  if (typeof candidate.id !== "string" || typeof candidate.name !== "string" || typeof candidate.uri !== "string" || !Array.isArray(candidate.relations)) {
    return false
  }

  return candidate.relations.every(
    (relation) =>
      relation &&
      typeof relation === "object" &&
      typeof (relation as { target?: unknown }).target === "string" &&
      typeof (relation as { type?: unknown }).type === "string"
  )
}
