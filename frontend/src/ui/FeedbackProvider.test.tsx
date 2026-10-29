import { act, fireEvent, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useFeedback, type Feedback } from './feedback'
import { FeedbackProvider } from './FeedbackProvider'

let feedback: Feedback

function Probe() {
  const value = useFeedback()
  useEffect(() => {
    feedback = value
  })
  return null
}

function renderProvider() {
  return render(
    <FeedbackProvider>
      <Probe />
    </FeedbackProvider>,
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('FeedbackProvider', () => {
  it('shows a toast and takes it away after a while', () => {
    vi.useFakeTimers()
    renderProvider()
    act(() => void feedback.toast({ message: 'Archived 1 item' }))
    expect(screen.getByRole('status')).toHaveTextContent('Archived 1 item')
    act(() => vi.advanceTimersByTime(5000))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('updates a toast in place by id, and keeps it with no duration', () => {
    vi.useFakeTimers()
    renderProvider()
    act(() => void feedback.toast({ id: 'job', message: 'Working…', duration: null }))
    act(() => void feedback.toast({ id: 'job', message: 'Done', duration: null }))
    act(() => vi.advanceTimersByTime(60_000))
    expect(screen.getAllByRole('status')).toHaveLength(1)
    expect(screen.getByRole('status')).toHaveTextContent('Done')
  })

  it('runs a toast action and closes the toast', () => {
    renderProvider()
    const undo = vi.fn()
    act(() => void feedback.toast({ message: 'Archived 1 item', actions: [{ label: 'Undo', onClick: undo }] }))
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(undo).toHaveBeenCalledOnce()
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows errors as alerts', () => {
    renderProvider()
    act(() => void feedback.toast({ message: 'Server error', tone: 'error' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Server error')
  })

  it('resolves a confirmation with the answer', async () => {
    renderProvider()
    let answer: Promise<boolean>
    act(() => void (answer = feedback.confirm({ title: 'Delete this?', confirm: 'Delete', danger: true })))
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this?' })
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await expect(answer!).resolves.toBe(true)
    expect(dialog).not.toBeInTheDocument()

    act(() => void (answer = feedback.confirm({ title: 'Delete this?', confirm: 'Delete' })))
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' })
    await expect(answer!).resolves.toBe(false)
  })

  it('keeps keys pressed in the dialog from the page shortcuts', () => {
    const shortcut = vi.fn()
    window.addEventListener('keydown', shortcut)
    renderProvider()
    act(() => void feedback.confirm({ title: 'Delete this?', confirm: 'Delete' }))
    fireEvent.keyDown(screen.getByRole('button', { name: 'Delete' }), { key: 'e' })
    expect(shortcut).not.toHaveBeenCalled()
    window.removeEventListener('keydown', shortcut)
  })
})
