import type { Size } from '../../core/types'

/**
 * Renders a user-selected image into a container element.
 * Handles object-fit, scale calculation, and resize observation.
 */
export class ImageRenderer {
  private imgEl: HTMLImageElement | null = null
  private resizeObserver: ResizeObserver | null = null
  private resizeCallbacks: Array<() => void> = []

  constructor(private container: HTMLElement) {}

  /**
   * Load a File and display it in the container.
   * Returns a Promise that resolves once the image has loaded.
   */
  load(file: File): Promise<void> {
    return new Promise((resolve, reject) => {
      // Remove previous image
      if (this.imgEl) {
        this.imgEl.remove()
        this.imgEl = null
      }
      if (this.resizeObserver) {
        this.resizeObserver.disconnect()
        this.resizeObserver = null
      }

      const url = URL.createObjectURL(file)
      const img = document.createElement('img')
      img.style.cssText = [
        'display:block',
        'width:100%',
        'height:100%',
        'object-fit:contain',
        'user-select:none',
        'pointer-events:none',
      ].join(';')

      img.onload = () => {
        URL.revokeObjectURL(url)
        this.imgEl = img
        this._startObserver()
        resolve()
      }

      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error(`Failed to load image: ${file.name}`))
      }

      img.src = url
      this.container.appendChild(img)
    })
  }

  /**
   * Scale factor: container CSS width / image natural width.
   * Used to convert pixel coordinates to screen coordinates.
   */
  getDisplayScale(): number {
    if (!this.imgEl) return 1
    const naturalWidth = this.imgEl.naturalWidth || 1
    return this.container.offsetWidth / naturalWidth
  }

  /** Natural image dimensions */
  getNaturalSize(): Size {
    if (!this.imgEl) return { width: 0, height: 0 }
    return {
      width: this.imgEl.naturalWidth,
      height: this.imgEl.naturalHeight,
    }
  }

  /** Bounding client rect of the container */
  getContainerBCR(): DOMRect {
    return this.container.getBoundingClientRect()
  }

  /** The underlying img element, or null if not yet loaded */
  getImgEl(): HTMLImageElement {
    if (!this.imgEl) throw new Error('ImageRenderer: image not loaded')
    return this.imgEl
  }

  /**
   * Register a callback for container resize.
   * Returns a cleanup function that removes the callback.
   */
  onResize(cb: () => void): () => void {
    this.resizeCallbacks.push(cb)
    return () => {
      this.resizeCallbacks = this.resizeCallbacks.filter(fn => fn !== cb)
    }
  }

  /** Clean up observers and DOM elements */
  destroy(): void {
    this.resizeObserver?.disconnect()
    this.resizeObserver = null
    this.imgEl?.remove()
    this.imgEl = null
    this.resizeCallbacks = []
  }

  private _startObserver(): void {
    this.resizeObserver = new ResizeObserver(() => {
      this.resizeCallbacks.forEach(cb => cb())
    })
    this.resizeObserver.observe(this.container)
  }
}
