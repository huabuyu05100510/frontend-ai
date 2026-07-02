import { Handle as XYFlowHandle, Position } from '@xyflow/react'
import clsx from 'clsx'
import { CSSProperties, forwardRef } from 'react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

import { useFlowEditorContext } from '../editor/context'
import { builtInNodeItems } from '../editor/node-catalog'
import { getColor } from '../icon-map'
import type { NodeKind } from '../settings/types'

interface HandleProps {
    type: 'source' | 'target'
    position: Position
    id?: string
    className?: string
    handleClassName?: string
    style?: CSSProperties
}

export const Handle = forwardRef<HTMLDivElement, HandleProps>(function Handle(
    { type, id, position, className, handleClassName, style },
    ref
) {
    const { onAddNode, availableNodes } = useFlowEditorContext()
    const isSource = type === 'source' && position === Position.Right
    const nodeItems = availableNodes || builtInNodeItems.filter(item => item.type !== 'start')

    return (
        <XYFlowHandle
            id={id}
            type={type}
            position={position}
            className={clsx(
                'flex',
                position === Position.Right ? 'justify-end' : 'justify-start',
                isSource ? 'group' : '',
                handleClassName
            )}
            style={{
                backgroundColor: 'transparent',
                ...style,
            }}
        >
            <div className={clsx('w-[2px] h-2 bg-purple-700', className)} />
            {isSource && onAddNode && (
                <div className="absolute -right-6 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <Popover>
                        <PopoverTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="h-5 w-5 rounded-full p-0 bg-purple-600 text-white hover:bg-purple-700 shadow-sm"
                            >
                                +
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" sideOffset={8} className="w-44 p-1">
                            <div className="text-xs text-gray-500 px-2 py-1">添加节点</div>
                            {nodeItems.map(item => (
                                <button
                                    key={item.type}
                                    type="button"
                                    onClick={() => onAddNode(item.type)}
                                    disabled={item.disabled}
                                    className={clsx(
                                        'w-full flex items-center gap-2 px-2 py-2 rounded transition-colors text-left',
                                        item.disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100'
                                    )}
                                >
                                    <div
                                        className={clsx(
                                            'shrink-0 w-5 h-5 rounded flex items-center justify-center text-white',
                                            !item.color && getColor(item.type)
                                        )}
                                        style={item.color ? { backgroundColor: item.color } : undefined}
                                    >
                                        {item.icon}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-gray-700">{item.label}</div>
                                        <div className="text-xs text-gray-400 truncate">{item.description}</div>
                                    </div>
                                </button>
                            ))}
                        </PopoverContent>
                    </Popover>
                </div>
            )}
        </XYFlowHandle>
    )
})
