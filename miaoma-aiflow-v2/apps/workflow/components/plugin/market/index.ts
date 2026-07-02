/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

export { InstallButton } from './install-button'
export { PluginCard, PluginCardSkeleton } from './plugin-card'
export { PluginDetail, PluginDetailSkeleton } from './plugin-detail'
export { Permissions, PermissionsSummary } from './plugin-detail/permissions'
export { VersionBadge, VersionsList } from './plugin-detail/versions'
export { PluginFilters, PluginFiltersCompact } from './plugin-filters'
export { CategorySection, FeaturedPlugins, PluginList } from './plugin-list'
export type {
    CategoryInfo,
    InstalledPlugin,
    PluginAuthor,
    PluginCategory,
    PluginFilters as PluginFiltersType,
    PluginInfo,
    PluginNodeInfo,
    PluginStatus,
    PluginVersion,
    PluginVersionStatus,
} from './types'
export { PERMISSION_LABELS, PLUGIN_CATEGORIES } from './types'
