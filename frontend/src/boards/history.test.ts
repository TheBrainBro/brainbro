import { describe, expect, it } from 'vitest'

import { History } from './history'

describe('History', () => {
  it('undoes and redoes in order', () => {
    const history = new History('a')
    history.push('b')
    history.push('c')
    expect(history.undo()).toBe('b')
    expect(history.undo()).toBe('a')
    expect(history.undo()).toBeUndefined()
    expect(history.redo()).toBe('b')
    expect(history.present).toBe('b')
  })

  it('a new change drops what could be redone', () => {
    const history = new History('a')
    history.push('b')
    history.undo()
    history.push('c')
    expect(history.canRedo).toBe(false)
    expect(history.undo()).toBe('a')
  })

  it('keeps a limited number of steps', () => {
    const history = new History(0, 2)
    for (const step of [1, 2, 3]) history.push(step)
    expect(history.undo()).toBe(2)
    expect(history.undo()).toBe(1)
    expect(history.canUndo).toBe(false)
  })

  it('reset forgets every step', () => {
    const history = new History('a')
    history.push('b')
    history.reset('z')
    expect([history.present, history.canUndo, history.canRedo]).toEqual(['z', false, false])
  })
})
