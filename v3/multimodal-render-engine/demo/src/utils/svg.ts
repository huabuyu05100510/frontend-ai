/**
 * SVG 元素工厂函数
 */

/** 创建带属性的 SVG 元素 */
export function makeSVGElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number>
): SVGElementTagNameMap[K] {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag)
  setAttrs(el, attrs)
  return el
}

/** 批量设置元素属性 */
export function setAttrs(el: Element, attrs: Record<string, string | number>): void {
  for (const [k, v] of Object.entries(attrs)) {
    el.setAttribute(k, String(v))
  }
}

/**
 * 生成波浪线 SVG path d 属性
 * @param x 起始 x
 * @param y 波浪线 y（通常为 rect.bottom + 2）
 * @param width 宽度
 * @param amp 振幅，默认 1.5
 * @param wavelength 波长，默认 5
 */
export function wavyPathD(x: number, y: number, width: number, amp = 1.5, wavelength = 5): string {
  const half = wavelength / 2
  const quarter = wavelength / 4
  let d = `M ${x} ${y}`
  let cx = x
  while (cx < x + width) {
    const remaining = x + width - cx
    if (remaining < quarter) break
    d += ` q ${quarter} ${-amp} ${half} 0`
    d += ` q ${quarter} ${amp} ${half} 0`
    cx += wavelength
  }
  return d
}
