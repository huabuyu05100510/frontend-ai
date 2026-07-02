/*
 *   Copyright (c) 2026 妙码学院 @Heyi
 *   All rights reserved.
 *   妙码学院官方出品，作者 @Heyi，供学员学习使用，可用作练习，可用作美化简历，不可开源。
 */

import { nodeSettingsRegistry } from '@/components/flow/settings/registry'
import type { NodeKind, NodeSettingsFormComponent } from '@/components/flow/settings/types'

import { createPluginNodeSettingsComponent } from './plugin-node'
import type { ExtendedJSONSchema7 } from './schema-form/types'

/**
 * 已注册的插件节点信息
 */
export interface RegisteredPluginNode {
    /** 插件 ID */
    pluginId: string
    /** 节点类型 */
    nodeType: string
    /** 节点名称 */
    name: string
    /** 节点描述 */
    description?: string
    /** 节点图标 */
    icon: string
    /** 节点颜色 */
    color: string
    /** 节点分类 */
    category: string
    /** 配置 Schema */
    configSchema: ExtendedJSONSchema7
    /** 输出定义 */
    outputs: Array<{
        name: string
        type: string
        description?: string
    }>
    /** 自定义组件 URL（可选） */
    customComponentUrl?: string
    /** 自定义组件名称（可选） */
    customComponentName?: string
    /** 插件权限列表 */
    permissions?: string[]
}

/**
 * 插件注册客户端
 * 负责在前端管理已安装的插件及其节点
 */
class PluginRegistryClient {
    private registeredPlugins: Map<string, RegisteredPluginNode[]> = new Map()

    private buildFullNodeType(pluginId: string, nodeType: string): NodeKind {
        return `plugin:${pluginId}:${nodeType}` as NodeKind
    }

    /**
     * 注册插件节点
     */
    registerPluginNode(plugin: RegisteredPluginNode): void {
        // 存储插件节点信息
        const nodes = this.registeredPlugins.get(plugin.pluginId) || []

        // 检查是否已注册
        const existingIndex = nodes.findIndex(n => n.nodeType === plugin.nodeType)
        if (existingIndex !== -1) {
            nodes[existingIndex] = plugin
        } else {
            nodes.push(plugin)
        }
        this.registeredPlugins.set(plugin.pluginId, nodes)

        // 创建设置表单组件并注册到 nodeSettingsRegistry
        const settingsComponent = createPluginNodeSettingsComponent({
            pluginId: plugin.pluginId,
            nodeType: plugin.nodeType,
            configSchema: plugin.configSchema,
            customComponentUrl: plugin.customComponentUrl,
            customComponentName: plugin.customComponentName,
            permissions: plugin.permissions,
        })

        // 使用完整的节点类型作为 key (pluginId:nodeType)
        const fullNodeType = this.buildFullNodeType(plugin.pluginId, plugin.nodeType)
        nodeSettingsRegistry.register(fullNodeType, settingsComponent as NodeSettingsFormComponent)
    }

    /**
     * 批量注册插件节点
     */
    registerPluginNodes(plugins: RegisteredPluginNode[]): void {
        plugins.forEach(plugin => this.registerPluginNode(plugin))
    }

    /**
     * 注销插件节点
     */
    unregisterPluginNode(pluginId: string, nodeType: string): void {
        const nodes = this.registeredPlugins.get(pluginId)
        if (!nodes) return

        const index = nodes.findIndex(n => n.nodeType === nodeType)
        if (index !== -1) {
            nodes.splice(index, 1)
            if (nodes.length === 0) {
                this.registeredPlugins.delete(pluginId)
            }
        }
        nodeSettingsRegistry.unregister(this.buildFullNodeType(pluginId, nodeType))
    }

    /**
     * 注销整个插件的所有节点
     */
    unregisterPlugin(pluginId: string): void {
        const nodes = this.registeredPlugins.get(pluginId) || []
        nodes.forEach(node => {
            nodeSettingsRegistry.unregister(this.buildFullNodeType(pluginId, node.nodeType))
        })
        this.registeredPlugins.delete(pluginId)
    }

    /**
     * 获取插件的所有节点
     */
    getPluginNodes(pluginId: string): RegisteredPluginNode[] {
        return this.registeredPlugins.get(pluginId) || []
    }

    /**
     * 获取所有已注册的插件节点
     */
    getAllPluginNodes(): RegisteredPluginNode[] {
        const allNodes: RegisteredPluginNode[] = []
        this.registeredPlugins.forEach(nodes => {
            allNodes.push(...nodes)
        })
        return allNodes
    }

    /**
     * 按分类获取插件节点
     */
    getPluginNodesByCategory(category: string): RegisteredPluginNode[] {
        return this.getAllPluginNodes().filter(n => n.category === category)
    }

    /**
     * 检查节点类型是否已注册
     */
    isNodeTypeRegistered(pluginId: string, nodeType: string): boolean {
        const nodes = this.registeredPlugins.get(pluginId)
        return nodes?.some(n => n.nodeType === nodeType) || false
    }

    /**
     * 获取节点类型信息
     */
    getNodeTypeInfo(pluginId: string, nodeType: string): RegisteredPluginNode | undefined {
        const nodes = this.registeredPlugins.get(pluginId)
        return nodes?.find(n => n.nodeType === nodeType)
    }

    /**
     * 清除所有已注册的插件节点
     */
    clear(): void {
        this.getAllPluginNodes().forEach(node => {
            nodeSettingsRegistry.unregister(this.buildFullNodeType(node.pluginId, node.nodeType))
        })
        this.registeredPlugins.clear()
    }
}

// 创建全局单例
export const pluginRegistryClient = new PluginRegistryClient()

/**
 * 从 API 响应初始化插件注册
 */
export function initializePluginRegistry(
    installedPlugins: Array<{
        pluginId: string
        permissions?: string[]
        componentsUrl?: string
        nodes: Array<{
            type: string
            name: string
            description?: string
            icon: string
            color: string
            category: string
            configSchema: ExtendedJSONSchema7
            outputs: Array<{
                name: string
                type: string
                description?: string
            }>
            /** 自定义组件名称（可选） */
            customComponent?: string
        }>
    }>
): void {
    installedPlugins.forEach(plugin => {
        plugin.nodes.forEach(node => {
            pluginRegistryClient.registerPluginNode({
                pluginId: plugin.pluginId,
                nodeType: node.type,
                name: node.name,
                description: node.description,
                icon: node.icon,
                color: node.color,
                category: node.category,
                configSchema: node.configSchema,
                outputs: node.outputs,
                customComponentUrl: node.customComponent ? plugin.componentsUrl : undefined,
                customComponentName: node.customComponent,
                permissions: plugin.permissions,
            })
        })
    })
}
