// 智检模式：错误 token（红色下划线，selected 时蓝色高亮）
// 模型：claude-sonnet-4-6
import type { RenderToken } from '../types'

interface Props {
  token: RenderToken & { errorId: string | null }
  isSelected: boolean
  onClick?: () => void
}

export function ErrorToken({ token, isSelected, onClick }: Props) {
  if (token.type === 'delete') {
    return (
      <span
        className={`diff-token-delete${isSelected ? ' is-selected' : ''}`}
        data-error-id={token.errorId || undefined}
        onClick={onClick}
        role={onClick ? 'button' : undefined}
        tabIndex={onClick ? 0 : undefined}
      >
        {token.text}
      </span>
    )
  }
  return <span className="diff-token-equal">{token.text}</span>
}
