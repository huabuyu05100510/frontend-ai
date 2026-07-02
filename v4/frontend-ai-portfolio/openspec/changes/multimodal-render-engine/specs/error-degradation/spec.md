# Error Degradation Specification

## ADDED Requirements

### Requirement: pdfium-wasm Load Failure

When the pdfium-wasm WebAssembly binary fails to load, the system SHALL display a degraded UI with a retry button rather than a white screen. Retry attempts SHALL be limited to a maximum of 2.

#### Scenario: wasm load timeout

- **WHEN** the pdfium-wasm `.wasm` file takes longer than 10 seconds to load from CDN
- **THEN** the DualColumnLayout SHALL display a loading skeleton with text "文档引擎加载中..."
- **AND** after 10 seconds, the skeleton SHALL be replaced with an error card: "文档引擎加载失败，请刷新重试"
- **AND** a [重试] button SHALL be displayed

#### Scenario: Successful retry

- **WHEN** the user clicks [重试]
- **THEN** the Worker SHALL be re-initialized with a cache-bust URL parameter
- **AND** the wasm SHALL be fetched again
- **WHEN** the load succeeds
- **THEN** the error card SHALL be replaced with the normal document rendering

#### Scenario: Retry also fails

- **WHEN** the second retry also fails
- **THEN** a final error message SHALL display: "请检查网络后刷新页面"
- **AND** no further automatic retry SHALL be attempted
- **AND** the [重试] button SHALL remain available for manual retry

### Requirement: ErrorBoundary Component

The ErrorBoundary SHALL catch rendering errors in any scene component and display a fallback UI. It SHALL support an injectable error reporter for external monitoring.

#### Scenario: Child component throws

- **WHEN** a child component throws an Error during render
- **THEN** the ErrorBoundary SHALL catch the error via `componentDidCatch`
- **AND** the `onError` callback SHALL be invoked with the error and errorInfo
- **AND** the fallback UI SHALL be rendered: ⚠️ icon + "渲染异常" + error message + [重试] button

#### Scenario: Retry via callback

- **WHEN** the user clicks [重试] in the fallback UI
- **THEN** the `onRetry` prop SHALL be called if provided
- **AND** if `onRetry` is not provided, `window.location.reload()` SHALL be called

#### Scenario: Stack overflow protection

- **WHEN** the same error boundary catches the same error type 3 times within 10 seconds
- **THEN** the fallback SHALL change to a persistent error state
- **AND** the message SHALL be "反复出现错误，请刷新页面"
- **AND** the [重试] button SHALL be replaced with [刷新页面]

### Requirement: Loading State Machine

Every scene component SHALL implement a 4-state loading flow: Loading → Loaded / Empty / Error. No component SHALL remain in a perpetual loading state or display a white screen on error.

#### Scenario: Normal loading flow

- **WHEN** a scene component mounts
- **THEN** it SHALL initially display LoadingSkeleton (matching the scene variant: canvas/text/image)
- **WHEN** data loads successfully
- **THEN** it SHALL transition to Loaded state and render the scene content
- **WHEN** data loads but is empty
- **THEN** it SHALL transition to Empty state and render EmptyState component

#### Scenario: Error loading flow

- **WHEN** data loading fails
- **THEN** the component SHALL transition to Error state
- **AND** the ErrorBoundary fallback SHALL be displayed
- **WHEN** the user clicks retry
- **THEN** the component SHALL transition back to Loading state

### Requirement: API Timeout and Retry Strategy

All API calls SHALL have defined timeouts and retry strategies. Automatic retries SHALL be limited to 1 attempt. Failed requests SHALL use AbortController for cancellation.

#### Scenario: Translation API timeout

- **WHEN** the translation API does not respond within 30 seconds
- **THEN** the request SHALL be aborted
- **AND** it SHALL be automatically retried once after a 2-second delay
- **IF** the retry also fails
- **THEN** a Toast SHALL display "翻译失败，请稍后重试 [重试]" with a manual retry action

#### Scenario: Inspection API timeout

- **WHEN** the inspection API does not respond within 15 seconds
- **THEN** the request SHALL be aborted
- **AND** it SHALL be automatically retried once
- **IF** the retry also fails
- **THEN** any partial results already received SHALL still be displayed
- **AND** a Toast SHALL indicate partial results

#### Scenario: OCR API timeout

- **WHEN** the OCR API does not respond within 20 seconds
- **THEN** the request SHALL be aborted
- **AND** it SHALL be automatically retried once
- **IF** the retry also fails with no results
- **THEN** an error state SHALL be displayed with a retry option

### Requirement: Memory Limit Enforcement

The system SHALL enforce a 300MB JS heap limit. When approaching the limit, pages SHALL be evicted from the virtual page pool. Single pages exceeding 50MB SHALL be rendered at reduced resolution.

#### Scenario: Approaching heap limit

- **WHEN** `performance.memory.usedJSHeapSize` exceeds 300MB
- **THEN** the oldest out-of-viewport page SHALL be evicted
- **AND** `ImageBitmap.close()` SHALL be called on the evicted page
- **AND** a `console.warn` SHALL log the current memory usage

#### Scenario: Large page downgrade

- **WHEN** a single page's `ImageBitmap` size (width × height × 4 bytes) exceeds 50MB
- **THEN** the page SHALL be re-rendered at 0.5x resolution
- **AND** a `console.warn` SHALL log the downgrade with page number

### Requirement: Scroll Sync Deadlock Prevention

The ScrollSyncBridge SHALL prevent infinite scroll loops using a lock flag. A 500ms timeout SHALL force-unlock as a safety measure.

#### Scenario: Lock flag prevents circular scroll

- **WHEN** a scroll event on the left pane triggers a scroll on the right pane
- **THEN** the lock flag SHALL be set to `true`
- **AND** the right pane's scroll event SHALL be ignored while the lock is active
- **AND** `requestAnimationFrame` SHALL release the lock

#### Scenario: Lock timeout safety

- **WHEN** the lock flag has been held for more than 500ms
- **THEN** the lock SHALL be force-released
- **AND** `console.warn` SHALL log "ScrollSync: lock timeout, force-unlocking"