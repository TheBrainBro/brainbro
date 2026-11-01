import { useEffect, useRef, useState, type ReactNode } from 'react'

export type DropdownTriggerProps = {
  onClick: () => void
  'aria-haspopup': 'menu' | 'dialog'
  'aria-expanded': boolean
}

/**
 * A button that opens a panel under it: a menu, or a small form with
 * `role="dialog"`. Clicking outside or Escape closes it; `children` gets
 * `close` for the choices that should.
 */
export function Dropdown({
  trigger,
  children,
  role = 'menu',
  label,
  align = 'right',
  className = 'w-56',
}: {
  trigger: (props: DropdownTriggerProps) => ReactNode
  children: (close: () => void) => ReactNode
  role?: 'menu' | 'dialog'
  label: string
  align?: 'left' | 'right'
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!box.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div ref={box} className="relative">
      {trigger({
        onClick: () => setOpen((value) => !value),
        'aria-haspopup': role,
        'aria-expanded': open,
      })}
      {open && (
        <div
          role={role}
          aria-label={label}
          className={`popover absolute top-full z-20 mt-2 p-1 ${
            align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left'
          } ${className}`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}
