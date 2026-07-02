export declare const requestIdleCallbackWithPolyfill: (cb: (deadline: {
    didTimeout: boolean;
    timeRemaining: () => number;
}) => void) => number;
export declare const cancelIdleCallbackWithPolyfill: (id: number) => void;
