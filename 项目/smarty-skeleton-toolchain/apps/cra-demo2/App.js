import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React, { useState } from 'react';
// import SmartySkeleton from 'smarty-skeleton-toolchain/src/SmartySkeleton';
var App = function () {
    var _a = useState(true), loading = _a[0], setLoading = _a[1];
    return (_jsxs("div", { style: { padding: '20px' }, children: [_jsx("h1", { children: "CRA Demo for SmartySkeleton" }), _jsx("button", { onClick: function () { return setLoading(!loading); }, children: "Toggle Loading" }), _jsx("div", { style: { marginTop: '20px' }, children: _jsx("div", { style: { width: '300px', height: '200px', background: '#87ceeb' }, children: "Real Content Here" }) })] }));
};
export default App;
