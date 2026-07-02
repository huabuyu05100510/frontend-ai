export var requestIdleCallbackWithPolyfill = function (cb) {
    var start = Date.now();
    return window.setTimeout(function () {
        cb({
            didTimeout: false,
            timeRemaining: function () { return Math.max(0, 40 - (Date.now() - start)); },
        });
    }, 1);
};
export var cancelIdleCallbackWithPolyfill = function (id) {
    clearTimeout(id);
};
