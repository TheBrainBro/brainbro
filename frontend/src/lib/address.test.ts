import { describe, expect, it } from 'vitest'

import { appHost, appOrigin, localReach } from './address'

describe('appOrigin', () => {
  it('is the public address when there is one', () => {
    expect(appOrigin({ authenticated: true, user: null, public_url: 'https://brain.example.com' })).toBe(
      'https://brain.example.com',
    )
    expect(appHost({ authenticated: true, user: null, public_url: 'https://brain.example.com:8443' })).toBe(
      'brain.example.com:8443',
    )
  })

  it("is the browser's address without one", () => {
    expect(appOrigin({ authenticated: true, user: null, public_url: '' })).toBe(window.location.origin)
    expect(appOrigin(undefined)).toBe(window.location.origin)
  })
})

describe('localReach', () => {
  it.each([
    ['localhost', 'computer'],
    ['127.0.0.1', 'computer'],
    ['[::1]', 'computer'],
    ['umbrel.local', 'network'],
    ['umbrel', 'network'],
    ['192.168.1.20', 'network'],
    ['10.0.0.5', 'network'],
    ['172.20.1.1', 'network'],
    ['100.101.102.103', 'network'],
    ['[fd00::1]', 'network'],
    ['brain.example.com', null],
    ['8.8.8.8', null],
    ['172.32.0.1', null],
  ])('%s is reached from %s', (hostname, reach) => {
    expect(localReach(hostname)).toBe(reach)
  })
})
