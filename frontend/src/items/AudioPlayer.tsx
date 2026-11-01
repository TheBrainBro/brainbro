/**
 * A recording, with the browser's own controls. Recordings made in a browser
 * (WebM) don't say how long they are, so the player can't show it or seek:
 * it is sent to the end once to find out, and back to the start.
 */
export function AudioPlayer({
  src,
  autoPlay = false,
  className = '',
}: {
  src: string | null
  autoPlay?: boolean
  className?: string
}) {
  return (
    <audio
      src={src ?? undefined}
      controls
      preload="metadata"
      // On a board: playing and seeking don't drag the card.
      className={`nodrag w-full ${className}`}
      onLoadedMetadata={(event) => {
        const audio = event.currentTarget
        const play = () => autoPlay && audio.play().catch(() => {})
        if (audio.duration !== Infinity) return play()
        audio.addEventListener(
          'durationchange',
          () => {
            audio.currentTime = 0
            play()
          },
          { once: true },
        )
        audio.currentTime = Number.MAX_SAFE_INTEGER
      }}
    />
  )
}
