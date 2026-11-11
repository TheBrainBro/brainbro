import { useId } from 'react'

// The artwork in this file is a BrainBro brand asset, not covered by the AGPL: see TRADEMARKS.md.

/** BrainBro's mark: the Blob's head, the simplified one from the brand kit (favicon.svg). */
export function Logo({ className = 'size-7' }: { className?: string }) {
  const id = useId()
  const skin = `${id}-skin`
  const cap = `${id}-cap`
  return (
    <svg viewBox="0 0 512 512" aria-hidden="true" className={className}>
      <g transform="translate(-9.44,-67.24) scale(1.1797)">
        <defs>
          <radialGradient id={skin} cx="40%" cy="38%" r="70%">
            <stop offset="0" stopColor="#D6C8F7" />
            <stop offset=".55" stopColor="#B9A2EE" />
            <stop offset="1" stopColor="#9B80E0" />
          </radialGradient>
          <linearGradient id={cap} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5A2CC0" />
            <stop offset="1" stopColor="#4B1FA8" />
          </linearGradient>
        </defs>
        <path
          d="M256,112 C372,112 442,192 442,302 C442,414 362,472 256,472 C150,472 70,414 70,302 C70,192 140,112 256,112Z"
          fill={`url(#${skin})`}
        />
        <path d="M118,212 C80,206 34,214 12,236 C6,244 12,252 24,252 C62,254 104,246 140,232 Z" fill="#3A1585" />
        <path d="M84,252 C82,150 160,88 256,88 C352,88 430,150 428,252 C340,274 172,274 84,252Z" fill={`url(#${cap})`} />
        <path d="M84,252 C172,274 340,274 428,252 L427,240 C340,262 172,262 85,240Z" fill="#3A1585" opacity=".55" />
        <path d="M222,266 L222,196 C222,170 240,160 268,160 C296,160 314,170 314,196 L314,266 Z" fill="#9B80E0" />
        <rect x="216" y="222" width="104" height="34" rx="9" fill="#F2B630" />
        <circle cx="256" cy="90" r="13" fill="#3A1585" />
        <circle cx="192" cy="336" r="40" fill="#24124F" />
        <circle cx="180" cy="321" r="14" fill="#FFFFFF" />
        <circle cx="207" cy="352" r="6.5" fill="#FFFFFF" />
        <circle cx="320" cy="336" r="40" fill="#24124F" />
        <circle cx="308" cy="321" r="14" fill="#FFFFFF" />
        <circle cx="335" cy="352" r="6.5" fill="#FFFFFF" />
        <ellipse cx="134" cy="392" rx="28" ry="16" fill="#F39BBF" opacity=".75" />
        <ellipse cx="378" cy="392" rx="28" ry="16" fill="#F39BBF" opacity=".75" />
        <path d="M236,398 Q256,418 276,398" fill="none" stroke="#24124F" strokeWidth="10" strokeLinecap="round" />
      </g>
    </svg>
  )
}

/** "BrainBro" as in the logo: Fredoka, "Bro" in the lighter violet. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-display font-semibold text-accent-700 dark:text-zinc-50 ${className}`}>
      Brain<span className="text-accent-500 dark:text-accent-300">Bro</span>
    </span>
  )
}
