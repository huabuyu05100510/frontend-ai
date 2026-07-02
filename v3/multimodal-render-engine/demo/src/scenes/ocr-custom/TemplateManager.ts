import type { FieldConfig, OCRTemplate } from '../../core/types'

const STORAGE_KEY = 'ocr-templates'

/**
 * Manages OCR template CRUD with localStorage persistence.
 * Each template has named fields with data types and validation rules.
 */
export class TemplateManager {
  private fields: FieldConfig[] = []
  private templates: OCRTemplate[] = []

  constructor() {
    this.load()
  }

  // ──────────────────── Field operations ────────────────────

  addField(config: FieldConfig): void {
    // Assign next order if not set
    const maxOrder = this.fields.reduce((max, f) => Math.max(max, f.order), -1)
    this.fields.push({ ...config, order: config.order ?? maxOrder + 1 })
    this.save()
  }

  updateField(id: string, patch: Partial<FieldConfig>): void {
    const idx = this.fields.findIndex(f => f.id === id)
    if (idx === -1) return
    this.fields[idx] = { ...this.fields[idx], ...patch }
    this.save()
  }

  removeField(id: string): void {
    this.fields = this.fields.filter(f => f.id !== id)
    this.save()
  }

  getFields(): FieldConfig[] {
    return [...this.fields].sort((a, b) => a.order - b.order)
  }

  // ──────────────────── Template operations ────────────────────

  saveTemplate(name: string, description?: string): OCRTemplate {
    const now = Date.now()
    const template: OCRTemplate = {
      id: `tpl-${now}`,
      name,
      description,
      fields: this.getFields(),
      createdAt: now,
      updatedAt: now,
    }
    this.templates.push(template)
    this.save()
    return template
  }

  loadTemplate(template: OCRTemplate): void {
    this.fields = template.fields.map(f => ({ ...f }))
    this.save()
  }

  getTemplates(): OCRTemplate[] {
    return [...this.templates]
  }

  // ──────────────────── Import / Export ────────────────────

  exportJSON(): string {
    return JSON.stringify(
      { fields: this.fields, templates: this.templates },
      null,
      2
    )
  }

  importJSON(json: string): void {
    try {
      const parsed = JSON.parse(json) as { fields?: FieldConfig[]; templates?: OCRTemplate[] }
      if (Array.isArray(parsed.fields)) {
        this.fields = parsed.fields
      }
      if (Array.isArray(parsed.templates)) {
        this.templates = parsed.templates
      }
      this.save()
    } catch (err) {
      throw new Error(`TemplateManager.importJSON: invalid JSON — ${(err as Error).message}`)
    }
  }

  // ──────────────────── Persistence ────────────────────

  private save(): void {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ fields: this.fields, templates: this.templates })
      )
    } catch {
      // Storage quota or private browsing – silently skip
    }
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as { fields?: FieldConfig[]; templates?: OCRTemplate[] }
      this.fields = Array.isArray(parsed.fields) ? parsed.fields : []
      this.templates = Array.isArray(parsed.templates) ? parsed.templates : []
    } catch {
      this.fields = []
      this.templates = []
    }
  }
}
