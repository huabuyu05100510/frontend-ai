export const requestIdleCallbackWithPolyfill = function(cb: any) {
  const start = Date.now();
  return setTimeout(() => {
    cb({
      didTimeout: false,
      timeRemaining: () => Math.max(0, 40 - (Date.now() - start)),
    });
  }, 1);
};

export const cancelIdleCallbackWithPolyfill = function(id: any) {
  clearTimeout(id);
};
