// 模型：claude-sonnet-4-6
// AllSourcesRegister — aggregator component that calls all 5 register-source hooks.
// Used by PaletteHost to wire up navigation + files + templates + voices + actions.

import { useRegisterNavigationItems } from './sources/navigation'
import { useRegisterFilesItems } from './sources/files'
import { useRegisterTemplatesItems } from './sources/templates'
import { useRegisterVoicesItems } from './sources/voices'
import { useRegisterActionsItems } from './sources/actions'

/**
 * 注册全部 palette sources 的无渲染组件。
 * 必须放在 React Router 上下文中（useNavigate 依赖）。
 */
export function RegisterAllSources(): null {
  useRegisterNavigationItems()
  useRegisterFilesItems()
  useRegisterTemplatesItems()
  useRegisterVoicesItems()
  useRegisterActionsItems()
  return null
}

// TODO (P3): 将 PaletteHost 的 useRegisterNavigationItems() 替换为 <RegisterAllSources />，
// 使 PaletteHost 内的所有 5 类 items 自动注册。当前 PaletteHost 在 web/src/App.tsx 中。