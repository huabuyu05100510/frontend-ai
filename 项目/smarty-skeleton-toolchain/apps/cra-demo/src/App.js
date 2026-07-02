import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import logo from './logo.svg';
import { SmartySkeleton } from '@smarty-skeleton-toolchain/react';
import './App.css';
function App() {
    var _a = useState(true), loading = _a[0], setLoading = _a[1];
    useEffect(function () {
        setTimeout(function () {
            setLoading(false);
        }, 1000);
    }, []);
    return (_jsx(SmartySkeleton, { id: 'ske-test', loading: loading, children: _jsx("div", { className: "App", children: _jsxs("header", { className: "App-header", children: [_jsx("img", { src: logo, className: "App-logo", alt: "logo" }), _jsxs("p", { children: ["Edit ", _jsx("code", { children: "src/App.tsx" }), " and save to reload."] }), _jsx("a", { className: "App-link", href: "https://reactjs.org", target: "_blank", rel: "noopener noreferrer", children: "Learn React" })] }) }) }));
}
export default App;
