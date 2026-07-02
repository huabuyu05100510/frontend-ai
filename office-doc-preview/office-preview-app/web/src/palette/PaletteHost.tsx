// 模型：claude-sonnet-4-6
// PaletteHost — 替代 App.tsx 中现有 PaletteHost 的 v2 版本，挂载时注册全部 5 类 sources。
//
// 用法（在 App.tsx 中切换）：
//   - import { PaletteHost } from './palette/PaletteHost'
//   - <PaletteHost />
//
// 当前 App.tsx 中的 PaletteHost 仅注册 navigation。本文件提供了 v2 版本（注册全部），
// 由 P3 阶段切换；切换前 App.tsx 不动。

import { RegisterAllSources } from './AllSourcesRegister'
import { Palette } from './Palette'
import { usePalette } from './usePalette'

export function PaletteHost(): JSX.Element {
  const palette = usePalette()
  return (
    <>
      <RegisterAllSources />
      <Palette palette={palette} />
    </>
  )
}

export default PaletteHost