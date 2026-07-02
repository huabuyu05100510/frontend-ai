/**
 * 菜单项统一数据结构
 * 三个系统都遵循此结构，由聚合器统一处理
 */
export interface MenuItem {
  /** 唯一 ID（全局唯一，建议带 system 前缀） */
  id: string;
  /** 显示标题 */
  title: string;
  /** 图标名（Ant Design icon 名） */
  icon?: string;
  /** 路由路径（无 path 则为分组标题，不可点击） */
  path?: string;
  /** 子菜单 */
  children?: MenuItem[];
  /** 权限码（无则表示无需权限） */
  permission?: string;
  /** 来源系统 */
  system: 'A' | 'B' | 'C';
  /** 排序权重（数字越小越靠前） */
  order?: number;
}