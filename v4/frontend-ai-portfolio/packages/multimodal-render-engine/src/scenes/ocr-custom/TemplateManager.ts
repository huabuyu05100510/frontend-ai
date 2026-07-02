/**
 * OCR 模板 CRUD 管理器
 *
 * localStorage 持久化，支持导出/导入 JSON。
 *
 * @module scenes/ocr-custom/TemplateManager
 */

import type { FieldConfig, OCRTemplate } from '../../core/types';

const STORAGE_KEY = 'ocr-templates';

/**
 * 模板管理器
 */
export class TemplateManager {
  private fields: FieldConfig[] = [];
  private templateName = '';
  private templateDescription = '';

  /** 添加字段 */
  addField(config: FieldConfig): void {
    this.fields.push({ ...config });
  }

  /** 更新字段 */
  updateField(id: string, patch: Partial<FieldConfig>): void {
    const index = this.fields.findIndex(f => f.id === id);
    if (index === -1) return;
    this.fields[index] = { ...this.fields[index], ...patch };
  }

  /** 移除字段 */
  removeField(id: string): void {
    this.fields = this.fields.filter(f => f.id !== id);
  }

  /** 获取所有字段 */
  getFields(): FieldConfig[] {
    return [...this.fields];
  }

  /** 设置模板元数据 */
  setMeta(name: string, description?: string): void {
    this.templateName = name;
    this.templateDescription = description ?? '';
  }

  /** 保存模板到 localStorage */
  saveTemplate(name?: string, description?: string): OCRTemplate {
    const template: OCRTemplate = {
      id: generateId(),
      name: name ?? this.templateName,
      description: description ?? this.templateDescription,
      fields: [...this.fields],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const templates = this.loadAllTemplates();
    // 更新或新增
    const existingIndex = templates.findIndex(t => t.name === template.name);
    if (existingIndex >= 0) {
      templates[existingIndex] = template;
    } else {
      templates.push(template);
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
    return template;
  }

  /** 加载模板 */
  loadTemplate(template: OCRTemplate): void {
    this.templateName = template.name;
    this.templateDescription = template.description ?? '';
    this.fields = template.fields.map(f => ({ ...f }));
  }

  /** 获取所有已保存模板 */
  loadAllTemplates(): OCRTemplate[] {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  /** 导出 JSON */
  exportJSON(): string {
    return JSON.stringify({
      name: this.templateName,
      description: this.templateDescription,
      fields: this.fields,
      exportedAt: Date.now(),
    }, null, 2);
  }

  /** 导入 JSON */
  importJSON(json: string): boolean {
    try {
      const data = JSON.parse(json);
      if (!data.fields || !Array.isArray(data.fields)) return false;

      this.templateName = data.name ?? '';
      this.templateDescription = data.description ?? '';
      this.fields = data.fields;
      return true;
    } catch {
      return false;
    }
  }

  /** 是否有字段 */
  get hasFields(): boolean {
    return this.fields.length > 0;
  }

  /** 清空 */
  clear(): void {
    this.fields = [];
    this.templateName = '';
    this.templateDescription = '';
  }
}

/** 生成唯一 ID */
function generateId(): string {
  return `tpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}