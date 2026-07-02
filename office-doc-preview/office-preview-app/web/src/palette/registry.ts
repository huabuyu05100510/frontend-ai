// 模型：claude-sonnet-4-6
// Palette registry — central store of all palette items (navigation, files, templates, etc.)

export interface PaletteItem {
  id: string
  title: string
  subtitle?: string
  group: string
  keywords?: string[]
  shortcut?: string
  action: () => void | Promise<void>
}

class PaletteRegistry {
  private items: Map<string, PaletteItem> = new Map()

  register(item: PaletteItem): void {
    this.items.set(item.id, item)
  }

  unregister(id: string): void {
    this.items.delete(id)
  }

  clear(): void {
    this.items.clear()
  }

  list(): PaletteItem[] {
    return Array.from(this.items.values())
  }

  search(query: string): PaletteItem[] {
    const q = query.trim().toLowerCase()
    if (!q) return this.list()
    return this.list().filter(item => {
      const haystack = [
        item.title,
        item.subtitle ?? '',
        item.group,
        ...(item.keywords ?? []),
      ].join(' ').toLowerCase()
      return haystack.includes(q)
    })
  }
}

export const paletteRegistry = new PaletteRegistry()

export function registerPaletteItems(items: PaletteItem[]): void {
  for (const item of items) {
    paletteRegistry.register(item)
  }
}