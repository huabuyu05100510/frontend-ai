export const requestIdleCallbackWithPolyfill = (
  cb: (deadline: { didTimeout: boolean; timeRemaining: () => number }) => void
): number => {
  const start = Date.now();
  return window.setTimeout(() => {
    cb({
      didTimeout: false,
      timeRemaining: () => Math.max(0, 40 - (Date.now() - start)),
    });
  }, 1);
};

export const cancelIdleCallbackWithPolyfill = (id: number) => {
  clearTimeout(id);
};
