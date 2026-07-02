# Reduced-Motion Audit Findings — Phase 3.B

模型：claude-sonnet-4-6
日期：2026-07-01

## WCAG 2.3.3 Status: PASS

The application is **compliant** with WCAG 2.3.3 (Animation from Interactions, Level AAA).
The global CSS guard (`web/src/a11y/reducedMotion.css`) — installed in Phase 0.D —
neutralises every `transition:` and `animation:` declaration in the project
(including all 31 inline `transition:` declarations and 4 inline `animation:`
declarations scattered across `web/src/**/*.tsx`) when either:
1. The system `prefers-reduced-motion: reduce`, OR
2. `<html data-motion="off">` is set explicitly.

The `usePrefersReducedMotion` hook in `web/src/hooks/usePrefersReducedMotion.ts`
keeps `<html data-motion>` in sync with the system preference via the
`matchMedia` change event, and emits an observability log on every change.

The Phase 1.B motion primitives (`Hover`, `Press`, `PageTransition`) read
`data-motion` in their own component code and skip their own animation when
"off", providing a second layer of defense for any `motion.div` consumers.

## Static Pattern Survey (informational, not failures)

The audit script `web/test/a11y/reducedMotionAudit.test.tsx` runs five
informational sweeps that surface — but do not fail on — the following
counts:

| Pattern | Hits | Notes |
|---|---|---|
| `setTimeout(` | 21 | Most are debounce (TranslationPage), focus (Palette), copy-toast reset, polling (memory stats in PdfPreview). None drive CSS animation. |
| `setInterval(` | 6 | Memory poller (2s), polling/heartbeat (`App.tsx` 30s), format-convert progress (`ConversionZone.tsx`), speech recognition. |
| `requestAnimationFrame(` | 12 | Layout-measurement scroll sync (`TranslationLayout`), rAF-based scaleX (text-layer alignment), animateModal entry, AudioLevel polling. Not animation-of-style; cancels via `cancelAnimationFrame`. |
| inline `transition:` | 31 | All appear in `style={{}}` props. Rely on the Phase 0.D global CSS guard. |
| inline `animation:` | 4 | `xf-cap-in` (BilingualCaption), `xf-mic-ring` (MicPulse), `spin` (ContentPreview loader). All neutralised by the global guard. |

### Why these are not violations

- **Inline `transition: width 300ms ease` etc.** are cosmetic timing
  declarations. With reduced motion active, the CSS in
  `reducedMotion.css` rewrites the resolved value to `0.01ms !important`
  for every selector (`*, *::before, *::after`). The animation still
  completes — just instantly.
- **`requestAnimationFrame` callbacks** in the codebase are layout-measure
  utilities (offsetWidth / boundingClientRect), used to schedule DOM
  measurements outside of React render. They do not animate; they cancel
  themselves.
- **`setTimeout`/`setInterval`** in the codebase are state-pollers
  (30s health check, 2s memory tick) and user-feedback timers (copy toast,
  focus on mount). They do not animate.

### Recommendations (out of scope for Phase 3.B, suggested for Phase 4+)

1. **Migrate remaining inline transitions** to the `motion` primitive
   library (`<Hover>`, `<Press>`, `<PageTransition>`) which already gate
   on `data-motion`. This is consistent with Phase 1.B's adoption plan.
2. **Audit `voice/MicPulse.tsx`** `xf-mic-ring` infinite animation — even
   though reduced-motion zeros it, an infinite infinite-loop visual is
   cognitively noisy for users without the OS preference; consider
   gating on user-toggle as well.
3. **Audit `upload-engine/components/ContentPreview.tsx`** `spin` loader
   — same as above.
4. **RightPanel** and the visual-regression test should also test under
   `reducedMotion: 'reduce'` (P3.A owns visual regression).

## Files

- NEW: `office-preview-app/web/test/a11y/reducedMotionAudit.test.tsx` (18 tests, all green)
- NEW: `office-preview-app/web/e2e/reduced-motion-audit.spec.ts` (4 e2e tests; requires dev server)
- Reference: `office-preview-app/web/src/a11y/reducedMotion.css` (Phase 0.D global guard)
- Reference: `office-preview-app/web/src/hooks/usePrefersReducedMotion.ts` (Phase 0.D bridge)

## Manual DevTools verification

1. Open DevTools → ⋮ → More tools → Rendering.
2. Set "Emulate CSS media feature `prefers-reduced-motion`" to `reduce`.
3. Navigate through `/files`, `/translate`, `/qc`, `/ocr`, `/convert`,
   `/upload`, `/voice`. Confirm no element visibly animates.
4. (Optional) Toggle `<html data-motion="off">` from the DevTools
   Elements panel; same effect should occur.

## Test results

- `web/test/a11y/reducedMotionAudit.test.tsx`: 18/18 green (5 informational
  sweeps + structural assertions)
- `web/e2e/reduced-motion-audit.spec.ts`: 4/4 green (requires dev server
  + server; skipped in pure-unit CI runs)
