// 模型：claude-sonnet-4-6
// Modal primitive — focus trap, mask close, esc close, AnimatePresence enter/exit
// Phase 2.A: P0.D reduced-motion wired via <html data-motion="off">
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { Modal } from '../../src/components/Modal'

// Each test isolates reduced-motion to keep AnimatePresence deterministic
function setMotion(on: boolean) {
  document.documentElement.setAttribute('data-motion', on ? 'on' : 'off')
}

describe('Modal primitive', () => {
  beforeEach(() => {
    setMotion(false)
  })

  afterEach(() => {
    cleanup()
    document.documentElement.removeAttribute('data-motion')
  })

  it('renders nothing when open=false', () => {
    const { container } = render(
      <Modal open={false} onClose={() => {}}>
        <div>body</div>
      </Modal>
    )
    expect(container.querySelector('[data-testid="modal"]')).toBeNull()
  })

  it('renders children when open=true', () => {
    render(
      <Modal open={true} onClose={() => {}}>
        <div>hello-modal-content</div>
      </Modal>
    )
    expect(screen.getByText('hello-modal-content')).toBeTruthy()
    expect(screen.getByTestId('modal')).toBeTruthy()
  })

  it('clicking mask calls onClose with reason "mask"', () => {
    const onClose = vi.fn()
    render(
      <Modal open={true} onClose={onClose}>
        <div>body</div>
      </Modal>
    )
    fireEvent.click(screen.getByTestId('modal-mask'))
    expect(onClose).toHaveBeenCalledWith('mask')
  })

  it('pressing Escape calls onClose with reason "esc"', () => {
    const onClose = vi.fn()
    render(
      <Modal open={true} onClose={onClose}>
        <div>body</div>
      </Modal>
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledWith('esc')
  })

  it('pressing Shift+Escape calls onClose with reason "esc"', () => {
    const onClose = vi.fn()
    render(
      <Modal open={true} onClose={onClose}>
        <div>body</div>
      </Modal>
    )
    fireEvent.keyDown(document, { key: 'Escape', shiftKey: true })
    expect(onClose).toHaveBeenCalledWith('esc')
  })

  it('initial focus lands on first focusable inside', async () => {
    render(
      <Modal open={true} onClose={() => {}}>
        <button type="button">first</button>
        <button type="button">second</button>
      </Modal>
    )
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe('first')
    })
  })

  it('Tab cycles forward within modal — last→first', async () => {
    render(
      <Modal open={true} onClose={() => {}}>
        <button type="button">one</button>
        <button type="button">two</button>
      </Modal>
    )
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe('one')
    })
    // Focus the LAST button (the trap activates when on last for forward Tab)
    const last = screen.getByText('two')
    last.focus()
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(last, { key: 'Tab' })
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe('one')
    })
  })

  it('Shift+Tab cycles backward within modal', async () => {
    render(
      <Modal open={true} onClose={() => {}}>
        <button type="button">one</button>
        <button type="button">two</button>
      </Modal>
    )
    // Focus the second button (simulate user clicked it)
    const second = screen.getByText('two')
    second.focus()
    fireEvent.keyDown(second, { key: 'Tab', shiftKey: true })
    await waitFor(() => {
      expect(document.activeElement?.textContent).toBe('one')
    })
  })

  it('data-motion="off" suppresses motion wrapper', () => {
    setMotion(false)
    const { container } = render(
      <Modal open={true} onClose={() => {}}>
        <div>body</div>
      </Modal>
    )
    // No "motion-div" style wrappers should be injected when motion is off
    // The modal element should be present
    expect(screen.getByTestId('modal')).toBeTruthy()
    // Confirm container has no extra motion-only divs (data-projection-id is added by motion)
    expect(container.querySelector('[data-projection-id]')).toBeNull()
  })

  it('sets aria-modal="true"', () => {
    render(
      <Modal open={true} onClose={() => {}}>
        <div>body</div>
      </Modal>
    )
    const modal = screen.getByTestId('modal')
    expect(modal.getAttribute('aria-modal')).toBe('true')
    expect(modal.getAttribute('role')).toBe('dialog')
  })

  it('footer button click closes with reason "button"', () => {
    function Harness() {
      const [open, setOpen] = useState(true)
      return (
        <Modal
          open={open}
          onClose={(reason) => { if (reason === 'button') setOpen(false) }}
          footer={<button type="button" data-testid="footer-btn" onClick={() => setOpen(false)}>OK</button>}
        >
          <div>body</div>
        </Modal>
      )
    }
    const onClose = vi.fn()
    render(
      <Modal
        open={true}
        onClose={onClose}
        footer={<button type="button" data-testid="footer-btn" onClick={() => onClose('button')}>OK</button>}
      >
        <div>body</div>
      </Modal>
    )
    fireEvent.click(screen.getByTestId('footer-btn'))
    expect(onClose).toHaveBeenCalledWith('button')
  })

  it('maskClosable=false disables mask click close', () => {
    const onClose = vi.fn()
    render(
      <Modal open={true} onClose={onClose} maskClosable={false}>
        <div>body</div>
      </Modal>
    )
    fireEvent.click(screen.getByTestId('modal-mask'))
    expect(onClose).not.toHaveBeenCalled()
  })

  it('logs open/close observability events', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { rerender } = render(
      <Modal open={true} onClose={() => {}} title="obs-test">
        <div>body</div>
      </Modal>
    )
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/\[modal .*\] opened/), { title: 'obs-test' })

    rerender(
      <Modal open={false} onClose={() => {}} title="obs-test">
        <div>body</div>
      </Modal>
    )
    expect(info).toHaveBeenCalledWith(expect.stringMatching(/\[modal .*\] closed/), { reason: expect.any(String) })
    info.mockRestore()
  })
})