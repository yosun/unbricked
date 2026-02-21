import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Full-viewport overlay shown during the initial slicing operation.
 * Displays the ingested image with a pulsing glow, indicating
 * segmentation is in progress. Fades out via CSS when unmounted.
 */
export default function SlicingOverlay({ imageUrl, label, }) {
    return (_jsxs("div", { style: {
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--overlay-bg)",
            zIndex: 70,
            pointerEvents: "none",
            animation: "slicingFadeIn 0.3s ease-out",
        }, children: [_jsxs("div", { style: {
                    position: "relative",
                    maxWidth: "60%",
                    maxHeight: "60%",
                }, children: [_jsx("div", { style: {
                            position: "absolute",
                            inset: -16,
                            borderRadius: 16,
                            background: "var(--processing-glow)",
                            opacity: 0.4,
                            filter: "blur(32px)",
                            animation: "slicingGlow 2s ease-in-out infinite",
                        } }), _jsx("img", { src: imageUrl, alt: "", style: {
                            position: "relative",
                            display: "block",
                            maxWidth: "100%",
                            maxHeight: "55vh",
                            borderRadius: 8,
                            boxShadow: "0 0 50px var(--processing-glow)",
                            animation: "slicingGlow 2s ease-in-out infinite",
                        } })] }), _jsxs("div", { style: {
                    marginTop: 24,
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    color: "var(--scrubber-active)",
                    fontSize: 14,
                    letterSpacing: 0.5,
                }, children: [_jsx("span", { style: {
                            display: "inline-block",
                            width: 14,
                            height: 14,
                            border: "2px solid var(--scrubber-active)",
                            borderTopColor: "transparent",
                            borderRadius: "50%",
                            animation: "opSpin 0.8s linear infinite",
                        } }), _jsx("span", { children: label })] })] }));
}
