import { describe, it, expect } from 'vitest'
import { parseXml, findAll, firstText, attr } from '../xml'

describe('parseXml', () => {
  it('解析嵌套元素与文本', () => {
    const root = parseXml('<a><b>hello</b><b>world</b></a>')
    expect(root.tag).toBe('a')
    expect(root.children.length).toBe(2)
    expect(root.children[0].tag).toBe('b')
    expect(firstText(root.children[0])).toBe('hello')
    expect(firstText(root.children[1])).toBe('world')
  })

  it('解析属性', () => {
    const root = parseXml('<w:p w:rsidR="00AB12" custom="x"><w:t>T</w:t></w:p>')
    expect(root.tag).toBe('w:p')
    expect(attr(root, 'w:rsidR')).toBe('00AB12')
    expect(attr(root, 'custom')).toBe('x')
  })

  it('处理自闭合标签', () => {
    const root = parseXml('<root><br/><img src="a.png"/></root>')
    expect(root.children.map((c) => c.tag)).toEqual(['br', 'img'])
    expect(attr(root.children[1], 'src')).toBe('a.png')
  })

  it('跳过 XML 声明与注释', () => {
    const root = parseXml('<?xml version="1.0"?><!-- c --><root>ok</root>')
    expect(root.tag).toBe('root')
    expect(firstText(root)).toBe('ok')
  })

  it('解码实体', () => {
    const root = parseXml('<t>a &amp; b &lt; c &gt; d &quot;e&quot; &#65;</t>')
    expect(firstText(root)).toBe('a & b < c > d "e" A')
  })

  it('保留命名空间前缀', () => {
    const root = parseXml('<w:document xmlns:w="x"><w:body/></w:document>')
    expect(root.tag).toBe('w:document')
    expect(root.children[0].tag).toBe('w:body')
  })
})

describe('findAll', () => {
  it('深度优先收集所有同名节点', () => {
    const root = parseXml('<doc><p><t>1</t></p><p><t>2</t><t>3</t></p></doc>')
    const ts = findAll(root, 't')
    expect(ts.map((n) => firstText(n))).toEqual(['1', '2', '3'])
  })

  it('无匹配返回空数组', () => {
    expect(findAll(parseXml('<a/>'), 'z')).toEqual([])
  })
})
