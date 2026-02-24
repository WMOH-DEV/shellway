import { useMemo } from 'react'
import { WifiOff, ExternalLink, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'

interface DisconnectedSessionViewProps {
  sessionName: string
  sessionHost?: string
  sessionPort?: number
  sessionUsername?: string
  sessionColor?: string
  error?: string
  onConnect: () => void
}

// ── Network topology background ──

/** Seeded pseudo-random for deterministic layouts */
function seededRandom(seed: number) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

interface TopoNode {
  id: number
  cx: number
  cy: number
  r: number
  delay: number
  duration: number
}

interface TopoEdge {
  from: TopoNode
  to: TopoNode
  delay: number
  duration: number
}

/** Generate a deterministic network topology based on session name */
function generateTopology(seed: string): { nodes: TopoNode[]; edges: TopoEdge[] } {
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash + seed.charCodeAt(i)) | 0
  }
  const rand = seededRandom(Math.abs(hash) || 42)

  const nodeCount = 20 + Math.floor(rand() * 12)
  const nodes: TopoNode[] = []

  for (let i = 0; i < nodeCount; i++) {
    nodes.push({
      id: i,
      cx: rand() * 100,
      cy: rand() * 100,
      r: 0.4 + rand() * 0.5,
      delay: rand() * 6,
      duration: 3 + rand() * 4,
    })
  }

  // Connect nearby nodes (Euclidean distance < threshold)
  const edges: TopoEdge[] = []
  const maxDist = 30
  for (let i = 0; i < nodes.length; i++) {
    let connections = 0
    for (let j = i + 1; j < nodes.length; j++) {
      const dx = nodes[i].cx - nodes[j].cx
      const dy = nodes[i].cy - nodes[j].cy
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist < maxDist && connections < 3 && rand() > 0.25) {
        edges.push({
          from: nodes[i],
          to: nodes[j],
          delay: rand() * 8,
          duration: 2 + rand() * 3,
        })
        connections++
      }
    }
  }

  return { nodes, edges }
}

/** Build the <style> block with all keyframe animations for the topology */
function buildAnimationStyles(nodes: TopoNode[], edges: TopoEdge[]): string {
  const keyframes: string[] = []

  // Node pulse animations
  nodes.forEach((node) => {
    keyframes.push(`
      @keyframes node-pulse-${node.id} {
        0%, 100% { opacity: 0.06; r: ${node.r}; }
        50% { opacity: 0.25; r: ${node.r * 1.8}; }
      }
    `)
  })

  // Edge glow animations
  edges.forEach((_, i) => {
    keyframes.push(`
      @keyframes edge-glow-${i} {
        0%, 100% { opacity: 0.04; }
        50% { opacity: 0.15; }
      }
    `)
  })

  // Data packet travel animations (subset of edges)
  edges.forEach((edge, i) => {
    const dx = edge.to.cx - edge.from.cx
    const dy = edge.to.cy - edge.from.cy
    keyframes.push(`
      @keyframes packet-${i} {
        0% { transform: translate(0px, 0px); opacity: 0; }
        10% { opacity: 0.6; }
        90% { opacity: 0.6; }
        100% { transform: translate(${dx}px, ${dy}px); opacity: 0; }
      }
    `)
  })

  // Cursor blink for watermark
  keyframes.push(`
    @keyframes cursor-blink {
      0%, 49% { opacity: 0.035; }
      50%, 100% { opacity: 0.012; }
    }
  `)

  return keyframes.join('\n')
}

function NetworkTopologyBackground({ sessionName }: { sessionName: string }) {
  const { nodes, edges } = useMemo(() => generateTopology(sessionName), [sessionName])
  const styles = useMemo(() => buildAnimationStyles(nodes, edges), [nodes, edges])

  // Pick ~40% of edges to have data packets
  const packetEdges = useMemo(() => {
    const rand = seededRandom(nodes.length * 7 + edges.length)
    return edges.filter(() => rand() > 0.6)
  }, [nodes.length, edges])

  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <style dangerouslySetInnerHTML={{ __html: styles }} />

      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid slice"
        className="absolute inset-0 w-full h-full"
      >
        <defs>
          {/* Radial fade so edges don't cut hard at viewport boundary */}
          <radialGradient id="topo-fade" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="white" stopOpacity="1" />
            <stop offset="60%" stopColor="white" stopOpacity="0.7" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </radialGradient>
          <mask id="topo-mask">
            <rect width="100" height="100" fill="url(#topo-fade)" />
          </mask>
        </defs>

        <g mask="url(#topo-mask)">
          {/* Connection lines */}
          {edges.map((edge, i) => (
            <line
              key={`e-${i}`}
              x1={edge.from.cx}
              y1={edge.from.cy}
              x2={edge.to.cx}
              y2={edge.to.cy}
              stroke="rgb(var(--nd-accent))"
              strokeWidth="0.12"
              style={{
                animation: `edge-glow-${i} ${3 + edge.duration}s ease-in-out ${edge.delay}s infinite`,
                opacity: 0.04,
              }}
            />
          ))}

          {/* Data packets traveling along edges */}
          {packetEdges.map((edge, i) => (
            <circle
              key={`p-${i}`}
              cx={edge.from.cx}
              cy={edge.from.cy}
              r="0.35"
              fill="rgb(var(--nd-accent))"
              style={{
                animation: `packet-${edges.indexOf(edge)} ${edge.duration + 1.5}s linear ${edge.delay}s infinite`,
                opacity: 0,
              }}
            />
          ))}

          {/* Nodes */}
          {nodes.map((node) => (
            <circle
              key={`n-${node.id}`}
              cx={node.cx}
              cy={node.cy}
              fill="rgb(var(--nd-accent))"
              style={{
                animation: `node-pulse-${node.id} ${node.duration}s ease-in-out ${node.delay}s infinite`,
                opacity: 0.06,
                r: node.r,
              }}
            />
          ))}
        </g>
      </svg>

      {/* Large terminal prompt watermark — the Shellway ">_" */}
      <div className="absolute inset-0 flex items-center justify-center">
        <svg
          viewBox="0 0 200 160"
          className="w-[50%] max-w-[520px]"
          style={{ opacity: 0.03 }}
        >
          <path
            d="M 20 20 L 100 80 L 20 140"
            fill="none"
            stroke="rgb(var(--nd-accent))"
            strokeWidth="16"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <rect
            x="120"
            y="120"
            width="60"
            height="16"
            rx="4"
            fill="rgb(var(--nd-accent))"
            style={{ animation: 'cursor-blink 1.2s step-end infinite' }}
          />
        </svg>
      </div>

      {/* Radial clear zone behind center content for readability */}
      <div
        className="absolute inset-0"
        style={{
          background: 'radial-gradient(ellipse 50% 45% at center, rgb(var(--nd-bg-primary)) 0%, rgb(var(--nd-bg-primary) / 0.85) 40%, transparent 70%)',
        }}
      />
    </div>
  )
}

// ── Main component ──

/**
 * Premium disconnected session view — shown when a session is selected but not connected,
 * or when an active connection drops. Ambient network topology background with session info.
 */
export function DisconnectedSessionView({
  sessionName,
  sessionHost,
  sessionPort,
  sessionUsername,
  sessionColor,
  error,
  onConnect
}: DisconnectedSessionViewProps) {
  return (
    <div className="relative flex flex-col items-center justify-center h-full px-8 animate-fade-in select-none overflow-hidden">
      {/* Ambient network topology background */}
      <NetworkTopologyBackground sessionName={sessionName} />

      {/* Content — sits above the background */}
      <div className="relative z-10 flex flex-col items-center">
        {/* Decorative icon with glow */}
        <div className="relative mb-8">
          {/* Background glow */}
          <div className="absolute -inset-12 rounded-full bg-nd-accent/[0.04] blur-3xl" />

          {/* Icon container */}
          <div className="relative w-24 h-24 rounded-3xl bg-gradient-to-br from-nd-bg-tertiary to-nd-surface border border-nd-border/50 flex items-center justify-center shadow-2xl shadow-black/30">
            {/* Subtle inner ring */}
            <div className="absolute inset-1.5 rounded-[18px] border border-nd-border/20" />
            <WifiOff size={40} className="text-nd-text-muted/40" />
          </div>

          {/* Status dot */}
          <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-nd-bg-primary border-2 border-nd-border flex items-center justify-center">
            <div className="w-2.5 h-2.5 rounded-full bg-nd-text-muted/30" />
          </div>
        </div>

        {/* Session info */}
        <div className="flex items-center gap-2.5 mb-2">
          <div
            className="w-3 h-3 rounded-full shrink-0 opacity-50"
            style={{ backgroundColor: sessionColor || '#71717a' }}
          />
          <h2 className="text-xl font-semibold text-nd-text-primary">
            {sessionName}
          </h2>
        </div>

        {sessionHost && (
          <p className="text-sm text-nd-text-muted font-mono mb-1">
            {sessionUsername && `${sessionUsername}@`}
            {sessionHost}
            {sessionPort && sessionPort !== 22 ? `:${sessionPort}` : ''}
          </p>
        )}

        <p className="text-xs text-nd-text-muted/50 mb-8 tracking-wide uppercase font-medium">
          Session Offline
        </p>

        {/* Error message */}
        {error && (
          <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg bg-nd-error/10 border border-nd-error/20 mb-6 max-w-sm">
            <AlertCircle size={15} className="text-nd-error/70 shrink-0 mt-0.5" />
            <p className="text-xs text-nd-error/70 leading-relaxed">{error}</p>
          </div>
        )}

        {/* Connect button */}
        <Button
          variant="primary"
          size="lg"
          onClick={onConnect}
          className="shadow-lg shadow-nd-accent/20 hover:shadow-nd-accent/30 transition-all"
        >
          <ExternalLink size={16} />
          Connect
        </Button>
      </div>
    </div>
  )
}
