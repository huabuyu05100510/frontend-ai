import { describe, it, expect } from 'vitest'
import { ROUTES, menuKeyToRoute, routeToMenuKey, MENU_KEYS } from '../../src/routes'

describe('route contract', () => {
  it('exports 10 routes for the 10 menu keys', () => {
    expect(ROUTES.files).toBe('/files')
    expect(ROUTES.translate).toBe('/translate')
    expect(ROUTES.qc).toBe('/qc')
    expect(ROUTES.ocr).toBe('/ocr')
    expect(ROUTES.convert).toBe('/convert')
    expect(ROUTES.upload).toBe('/upload')
    expect(ROUTES.voice).toBe('/voice')
    expect(ROUTES.bookmarks).toBe('/bookmarks')
    expect(ROUTES.samples).toBe('/samples')
    expect(ROUTES.gallery).toBe('/gallery')
  })

  it('MENU_KEYS has exactly 10 entries', () => {
    expect(MENU_KEYS).toHaveLength(10)
  })

  it('menuKeyToRoute maps every menu key to a valid route', () => {
    for (const key of MENU_KEYS) {
      const route = menuKeyToRoute(key)
      expect(route).toMatch(/^\//)
      expect(Object.values(ROUTES)).toContain(route)
    }
  })

  it('routeToMenuKey is the inverse of menuKeyToRoute', () => {
    for (const key of MENU_KEYS) {
      const route = menuKeyToRoute(key)
      expect(routeToMenuKey(route)).toBe(key)
    }
  })

  it('routeToMenuKey returns "files" for unknown routes (default fallback)', () => {
    expect(routeToMenuKey('/unknown')).toBe('files')
    expect(routeToMenuKey('/')).toBe('files')
  })

  it('routeToMenuKey handles nested paths (extracts first segment)', () => {
    expect(routeToMenuKey('/files/task/abc')).toBe('files')
    expect(routeToMenuKey('/translate?q=foo')).toBe('translate')
  })
})