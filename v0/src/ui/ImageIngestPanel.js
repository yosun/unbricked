import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useRef, useState } from "react";
import { OPERATIONS } from "../core/operations";
export default function ImageIngestPanel({ defaultOperationId, onCommit, onCancel, proxyGenerate, }) {
    const [tab, setTab] = useState("import");
    const [operationId, setOperationId] = useState(defaultOperationId);
    const [segmentMode, setSegmentMode] = useState("filtered");
    const showSegmentMode = operationId === "sam3.segment";
    // ── Import state ──
    const [previewUrl, setPreviewUrl] = useState(null);
    const [importFile, setImportFile] = useState(null);
    const fileRef = useRef(null);
    // ── Generate state ──
    const [prompt, setPrompt] = useState("");
    const [generating, setGenerating] = useState(false);
    const [genError, setGenError] = useState(null);
    const [genPreview, setGenPreview] = useState(null);
    const abortRef = useRef(null);
    /* ── Import helpers ── */
    const handleFileSelect = useCallback((e) => {
        const file = e.target.files?.[0];
        if (!file)
            return;
        setImportFile(file);
        const reader = new FileReader();
        reader.onload = () => { setPreviewUrl(reader.result); };
        reader.readAsDataURL(file);
    }, []);
    const handleImportCommit = useCallback(async () => {
        if (!importFile || !previewUrl)
            return;
        const buffer = await importFile.arrayBuffer();
        const { w, h } = await new Promise((resolve) => {
            const img = new Image();
            img.onload = () => { resolve({ w: img.naturalWidth, h: img.naturalHeight }); };
            img.onerror = () => { resolve({ w: 0, h: 0 }); };
            img.src = previewUrl;
        });
        onCommit({
            imageUrl: previewUrl,
            width: w,
            height: h,
            bytes: buffer,
            mediaType: importFile.type || "image/png",
            operationId,
            segmentMode: showSegmentMode ? segmentMode : undefined,
        });
    }, [importFile, previewUrl, onCommit, operationId]);
    /* ── Generate helpers ── */
    const handleGenerate = useCallback(async () => {
        if (!prompt.trim())
            return;
        setGenerating(true);
        setGenError(null);
        setGenPreview(null);
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const result = await proxyGenerate(prompt.trim(), controller.signal);
            setGenPreview({
                url: result.url,
                width: result.width ?? 0,
                height: result.height ?? 0,
            });
        }
        catch (err) {
            if (err instanceof DOMException && err.name === "AbortError")
                return;
            setGenError(err instanceof Error ? err.message : "Generation failed");
        }
        finally {
            setGenerating(false);
        }
    }, [prompt, proxyGenerate]);
    const handleGenCommit = useCallback(async () => {
        if (!genPreview)
            return;
        try {
            const resp = await fetch(genPreview.url);
            if (!resp.ok)
                throw new Error("Failed to fetch generated image");
            const blob = await resp.blob();
            const buffer = await blob.arrayBuffer();
            // Read actual dimensions if not provided
            let { width, height } = genPreview;
            if (!width || !height) {
                const dataUrl = URL.createObjectURL(blob);
                const dims = await new Promise((resolve) => {
                    const img = new Image();
                    img.onload = () => {
                        resolve({ w: img.naturalWidth, h: img.naturalHeight });
                        URL.revokeObjectURL(dataUrl);
                    };
                    img.onerror = () => {
                        resolve({ w: 0, h: 0 });
                        URL.revokeObjectURL(dataUrl);
                    };
                    img.src = dataUrl;
                });
                width = dims.w;
                height = dims.h;
            }
            // Convert to data URL for storage
            const reader = new FileReader();
            const dataUrl = await new Promise((resolve, reject) => {
                reader.onload = () => { resolve(reader.result); };
                reader.onerror = () => { reject(new Error("Failed to read blob")); };
                reader.readAsDataURL(blob);
            });
            onCommit({
                imageUrl: dataUrl,
                width,
                height,
                bytes: buffer,
                mediaType: blob.type || "image/png",
                operationId,
                segmentMode: showSegmentMode ? segmentMode : undefined,
                prompt: prompt.trim(),
            });
        }
        catch (err) {
            setGenError(err instanceof Error ? err.message : "Failed to commit generated image");
        }
    }, [genPreview, onCommit, operationId, prompt]);
    const btnBase = {
        padding: "8px 18px",
        borderRadius: 6,
        border: "none",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: 600,
    };
    const btnPrimary = {
        ...btnBase,
        background: "var(--scrubber-active)",
        color: "var(--btn-primary-text)",
    };
    const btnSecondary = {
        ...btnBase,
        background: "transparent",
        border: "1px solid var(--hud-border-btn)",
        color: "var(--hud-text)",
    };
    return (_jsx("div", { style: {
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 100,
            background: "var(--overlay-scrim)",
            backdropFilter: "blur(4px)",
        }, onClick: (e) => {
            if (e.target === e.currentTarget)
                onCancel();
        }, children: _jsxs("div", { style: {
                background: "var(--hud-bg)",
                border: "1px solid var(--hud-border)",
                borderRadius: 12,
                width: 440,
                maxHeight: "80vh",
                overflow: "auto",
                padding: 0,
                animation: "ingestSlideIn 0.2s ease-out",
            }, children: [_jsxs("div", { style: {
                        padding: "14px 20px 10px",
                        borderBottom: "1px solid var(--hud-border)",
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                    }, children: [_jsx("span", { style: { fontSize: 12, color: "var(--hud-muted)", whiteSpace: "nowrap" }, children: "Default operation" }), _jsx("select", { value: operationId, onChange: (e) => { setOperationId(e.target.value); }, style: {
                                flex: 1,
                                padding: "4px 8px",
                                background: "var(--hud-active)",
                                border: "1px solid var(--hud-border-btn)",
                                borderRadius: 4,
                                color: "var(--hud-text)",
                                fontSize: 12,
                            }, children: OPERATIONS.map((op) => (_jsx("option", { value: op.id, children: op.label }, op.id))) })] }), showSegmentMode && (_jsxs("div", { style: {
                        padding: "8px 20px 10px",
                        borderBottom: "1px solid var(--hud-border)",
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                    }, children: [_jsx("span", { style: { fontSize: 12, color: "var(--hud-muted)", whiteSpace: "nowrap" }, children: "Segmentation" }), ["filtered", "raw"].map((mode) => (_jsx("button", { type: "button", onClick: () => { setSegmentMode(mode); }, style: {
                                padding: "3px 10px",
                                borderRadius: 4,
                                border: segmentMode === mode
                                    ? "1px solid var(--scrubber-active)"
                                    : "1px solid var(--hud-border-btn)",
                                background: segmentMode === mode ? "var(--hud-active)" : "transparent",
                                color: segmentMode === mode ? "var(--hud-text)" : "var(--hud-muted)",
                                cursor: "pointer",
                                fontSize: 11,
                                fontWeight: 600,
                            }, children: mode === "filtered" ? "Filtered" : "Raw (all masks)" }, mode)))] })), _jsx("div", { style: { display: "flex", borderBottom: "1px solid var(--hud-border)" }, children: ["import", "generate"].map((t) => (_jsx("button", { type: "button", onClick: () => { setTab(t); }, style: {
                            flex: 1,
                            padding: "10px 0",
                            background: tab === t ? "var(--hud-active)" : "transparent",
                            border: "none",
                            borderBottom: tab === t ? "2px solid var(--scrubber-active)" : "2px solid transparent",
                            color: tab === t ? "var(--hud-text)" : "var(--hud-muted)",
                            cursor: "pointer",
                            fontSize: 13,
                            fontWeight: 600,
                        }, children: t === "import" ? "Import Image" : "Describe → Generate" }, t))) }), _jsxs("div", { style: { padding: 20 }, children: [tab === "import" && (_jsxs("div", { children: [_jsx("input", { ref: fileRef, type: "file", accept: "image/*", onChange: handleFileSelect, style: { display: "none" } }), !previewUrl ? (_jsx("button", { type: "button", onClick: () => fileRef.current?.click(), style: {
                                        width: "100%",
                                        padding: "40px 0",
                                        background: "var(--hud-active)",
                                        border: "2px dashed var(--hud-border-btn)",
                                        borderRadius: 8,
                                        color: "var(--hud-muted)",
                                        cursor: "pointer",
                                        fontSize: 14,
                                    }, children: "Click to select an image\u2026" })) : (_jsxs("div", { style: { textAlign: "center" }, children: [_jsx("img", { src: previewUrl, alt: "Preview", style: {
                                                maxWidth: "100%",
                                                maxHeight: 220,
                                                borderRadius: 6,
                                                objectFit: "contain",
                                                marginBottom: 14,
                                            } }), _jsxs("div", { style: { display: "flex", gap: 10, justifyContent: "center" }, children: [_jsx("button", { type: "button", style: btnPrimary, onClick: () => void handleImportCommit(), children: "Create Space" }), _jsx("button", { type: "button", style: btnSecondary, onClick: () => {
                                                        setPreviewUrl(null);
                                                        setImportFile(null);
                                                    }, children: "Clear" })] })] }))] })), tab === "generate" && (_jsxs("div", { children: [_jsx("textarea", { value: prompt, onChange: (e) => { setPrompt(e.target.value); }, placeholder: "Describe the image you want to generate\u2026", rows: 3, style: {
                                        width: "100%",
                                        padding: "8px 10px",
                                        background: "var(--hud-active)",
                                        border: "1px solid var(--hud-border-btn)",
                                        borderRadius: 6,
                                        color: "var(--hud-text)",
                                        fontSize: 13,
                                        resize: "vertical",
                                        boxSizing: "border-box",
                                    } }), _jsx("div", { style: { marginTop: 10, display: "flex", gap: 10 }, children: _jsx("button", { type: "button", style: {
                                            ...btnPrimary,
                                            opacity: generating || !prompt.trim() ? 0.5 : 1,
                                        }, disabled: generating || !prompt.trim(), onClick: () => void handleGenerate(), children: generating ? "Generating…" : "Generate" }) }), genError && (_jsxs("div", { style: {
                                        marginTop: 10,
                                        padding: "8px 12px",
                                        background: "rgba(255,80,80,0.15)",
                                        borderRadius: 6,
                                        color: "var(--color-error)",
                                        fontSize: 12,
                                    }, children: [genError, _jsx("button", { type: "button", style: {
                                                ...btnSecondary,
                                                marginLeft: 10,
                                                padding: "3px 10px",
                                                fontSize: 11,
                                            }, onClick: () => void handleGenerate(), children: "Retry" })] })), genPreview && (_jsxs("div", { style: { marginTop: 14, textAlign: "center" }, children: [_jsx("img", { src: genPreview.url, alt: "Generated", style: {
                                                maxWidth: "100%",
                                                maxHeight: 220,
                                                borderRadius: 6,
                                                objectFit: "contain",
                                                marginBottom: 14,
                                            } }), _jsxs("div", { style: { display: "flex", gap: 10, justifyContent: "center" }, children: [_jsx("button", { type: "button", style: btnPrimary, onClick: () => void handleGenCommit(), children: "Enter the Image" }), _jsx("button", { type: "button", style: btnSecondary, onClick: () => { setGenPreview(null); }, children: "Discard" })] })] }))] }))] }), _jsx("div", { style: {
                        padding: "10px 20px 14px",
                        borderTop: "1px solid var(--hud-border)",
                        textAlign: "right",
                    }, children: _jsx("button", { type: "button", style: btnSecondary, onClick: onCancel, children: "Cancel" }) })] }) }));
}
