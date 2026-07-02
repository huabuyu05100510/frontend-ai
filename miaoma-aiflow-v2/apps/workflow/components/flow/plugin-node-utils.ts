import {
    buildPluginNodeType as buildPluginNodeTypeBase,
    isPluginNodeType,
    type ParsedPluginNodeType,
    parsePluginNodeType,
} from '@miaoma-aiflow/plugin-runtime'

import type { ExtendedJSONSchema7 } from '@/components/plugin/schema-form/types'

import type { NodeKind } from './settings/types'

export function buildPluginNodeType(pluginId: string, nodeType: string): NodeKind {
    return buildPluginNodeTypeBase(pluginId, nodeType) as NodeKind
}

export { isPluginNodeType, parsePluginNodeType }
export type { ParsedPluginNodeType }

export function extractSchemaDefaults(schema?: ExtendedJSONSchema7): Record<string, unknown> {
    const value = extractDefaultValue(schema)
    return isPlainObject(value) ? value : {}
}

function extractDefaultValue(schema?: ExtendedJSONSchema7): unknown {
    if (!schema || typeof schema !== 'object') {
        return undefined
    }

    if (schema.default !== undefined) {
        return schema.default
    }

    const properties = schema.properties
    if (!properties || typeof properties !== 'object') {
        return undefined
    }

    const result: Record<string, unknown> = {}
    let hasDefaultValue = false

    Object.entries(properties).forEach(([key, propertySchema]) => {
        const childDefault = extractDefaultValue(propertySchema)
        if (childDefault !== undefined) {
            result[key] = childDefault
            hasDefaultValue = true
        }
    })

    return hasDefaultValue ? result : undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
