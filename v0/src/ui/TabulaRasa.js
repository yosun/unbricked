import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from "react";
/**
 * Tabula Rasa — the cosmological root state.
 * A minimal, centered opening message before the first node is created.
 */
export default function TabulaRasa({ onTap }) {
    const [phase, setPhase] = useState("in");
    // Fade in on mount
    useEffect(() => {
        const id = requestAnimationFrame(() => { setPhase("visible"); });
        return () => { cancelAnimationFrame(id); };
    }, []);
    const handleClick = useCallback(() => {
        if (phase === "out" || phase === "gone")
            return;
        setPhase("out");
        setTimeout(() => {
            setPhase("gone");
            onTap();
        }, 150);
    }, [phase, onTap]);
    if (phase === "gone")
        return _jsx(_Fragment, {});
    return (_jsx("div", { className: "tabula-rasa", onClick: handleClick, style: {
            opacity: phase === "visible" ? 1 : 0,
        }, children: _jsxs("div", { className: "tabula-rasa-content", children: [_jsx("p", { className: "tabula-rasa-line1", children: "Unbricked" }), _jsx("p", { className: "tabula-rasa-line2", children: "The unexamined brick is not worth editing." }), _jsx("p", { className: "tabula-rasa-line3", children: "Tap to begin." })] }) }));
}
