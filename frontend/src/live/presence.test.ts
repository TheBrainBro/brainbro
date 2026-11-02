import { describe, expect, it } from 'vitest'

import { deviceName, myPresence } from './presence'

const AGENTS = {
  chromeMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  safariIphone:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  edgeWindows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
  firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
}

describe('deviceName', () => {
  it('names the browser and the device', () => {
    expect(deviceName(AGENTS.chromeMac)).toBe('Chrome on Mac')
    expect(deviceName(AGENTS.safariIphone)).toBe('Safari on iPhone')
    expect(deviceName(AGENTS.edgeWindows)).toBe('Edge on Windows')
    expect(deviceName(AGENTS.firefoxAndroid)).toBe('Firefox on Android')
  })

  it('says what it can of an unknown one', () => {
    expect(deviceName('curl/8.0')).toBe('Another device')
  })
})

describe('myPresence', () => {
  it('keeps one color per device', () => {
    localStorage.clear()
    const first = myPresence()
    expect(myPresence().color).toBe(first.color)
    expect(first.colorLight).toBe(`${first.color}33`)
  })
})
