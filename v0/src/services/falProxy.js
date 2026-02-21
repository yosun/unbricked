import { z } from "zod";
/**
 * fal.ai drop-in proxy client.
 *
 * The proxy mirrors fal.ai's REST API.
 *
 * img2img route (fal-ai/flux/dev/image-to-image):
 *   POST <base>/fal-ai/flux/dev/image-to-image
 *   Body: JSON { image_url, prompt, strength?, num_inference_steps?, seed? }
 *   Response: { images: [{ url, content_type?, width?, height? }], ... }
 */
const isLocalhost = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
const PROXY_BASE = isLocalhost
    ? (import.meta.env.VITE_FAL_PROXY_LOCALHOST_URL || import.meta.env.VITE_FAL_PROXY_URL)
    : import.meta.env.VITE_FAL_PROXY_URL;
if (!PROXY_BASE) {
    throw new Error("VITE_FAL_PROXY_URL environment variable is required. " +
        "Please create a .env file with VITE_FAL_PROXY_URL and VITE_FAL_PROXY_LOCALHOST_URL set to your proxy endpoints.");
}
/** Default fal.ai endpoint paths for common operations. */
export const FAL_ENDPOINTS = {
    bgRemoval: "fal-ai/birefnet",
    autoSegment: "fal-ai/sam2/auto-segment",
    imageTo3D: "fal-ai/sam-3/3d-objects",
    img2img: "fal-ai/flux/dev/image-to-image",
    textToImg: "fal-ai/flux/dev",
};
/**
 * Max JSON body size (bytes) we allow for proxy requests.
 * API Gateway has a 10 MB limit; we stay well under to leave room for the rest
 * of the JSON payload besides the image.
 */
const MAX_BODY_BYTES = 7 * 1024 * 1024; // 7 MB
/** Max edge (px) when downscaling an image for the proxy. */
const MAX_IMAGE_EDGE = 2048;
/* ── Helpers ──────────────────────────────────────── */
/**
 * Downscale a data: URL image if the resulting JSON body would exceed the proxy
 * payload limit.  Shrinks the longest edge to MAX_IMAGE_EDGE and re-encodes as
 * JPEG at quality 0.85.  Returns the original URL untouched if it's already
 * small enough or isn't a data: URL.
 */
async function compressDataUrl(dataUrl, bodyOverhead) {
    if (!dataUrl.startsWith("data:"))
        return dataUrl;
    // Fast check: if the encoded length is already safe, skip compression.
    if (dataUrl.length + bodyOverhead <= MAX_BODY_BYTES)
        return dataUrl;
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const origW = img.naturalWidth;
            const origH = img.naturalHeight;
            let w = origW;
            let h = origH;
            const longest = Math.max(w, h);
            if (longest > MAX_IMAGE_EDGE) {
                const scale = MAX_IMAGE_EDGE / longest;
                w = Math.round(w * scale);
                h = Math.round(h * scale);
            }
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            if (!ctx) {
                reject(new Error("Canvas 2D context unavailable"));
                return;
            }
            ctx.drawImage(img, 0, 0, w, h);
            // Try PNG first (lossless) — important for segmentation quality
            const pngUrl = canvas.toDataURL("image/png");
            if (pngUrl.length + bodyOverhead <= MAX_BODY_BYTES) {
                console.info(`[compressDataUrl] ${origW}×${origH} → ${String(w)}×${String(h)} PNG (${(pngUrl.length / 1024).toFixed(0)} KB)`);
                resolve(pngUrl);
                return;
            }
            // Fall back to JPEG at progressively lower quality
            for (const quality of [0.92, 0.85, 0.7, 0.5]) {
                const compressed = canvas.toDataURL("image/jpeg", quality);
                if (compressed.length + bodyOverhead <= MAX_BODY_BYTES) {
                    console.info(`[compressDataUrl] ${origW}×${origH} → ${String(w)}×${String(h)} JPEG q=${String(quality)} (${(compressed.length / 1024).toFixed(0)} KB)`);
                    resolve(compressed);
                    return;
                }
            }
            // Last resort — use lowest quality result even if still large
            const fallback = canvas.toDataURL("image/jpeg", 0.5);
            console.warn(`[compressDataUrl] ${origW}×${origH} → ${String(w)}×${String(h)} JPEG q=0.5 OVERSIZE (${(fallback.length / 1024).toFixed(0)} KB)`);
            resolve(fallback);
        };
        img.onerror = () => { reject(new Error("Failed to load image for compression")); };
        img.src = dataUrl;
    });
}
/**
 * Wrapper around `fetch` with:
 * - Configurable timeout (default 120 s for model inference)
 * - One automatic retry on transient network errors
 * - Descriptive error messages
 */
async function proxyFetch(url, init, opts) {
    const timeoutMs = opts?.timeoutMs ?? 120_000;
    const outer = opts?.signal;
    const attempt = async (isRetry) => {
        const controller = new AbortController();
        // Link to the caller's signal
        const onOuterAbort = () => { controller.abort(); };
        outer?.addEventListener("abort", onOuterAbort, { once: true });
        const timer = timeoutMs > 0
            ? setTimeout(() => { controller.abort(); }, timeoutMs)
            : undefined;
        try {
            const resp = await fetch(url, { ...init, signal: controller.signal });
            return resp;
        }
        catch (err) {
            // If the caller aborted, propagate immediately
            if (outer?.aborted)
                throw err;
            // Distinguish timeout from other network errors
            if (controller.signal.aborted && !outer?.aborted) {
                throw new Error(`Proxy request timed out after ${String(timeoutMs / 1000)}s — the model may be cold-starting. Please retry.`);
            }
            // Retry once on transient network failures
            if (!isRetry && err instanceof TypeError && /failed to fetch/i.test(err.message)) {
                await new Promise((r) => { setTimeout(r, 2000); });
                return attempt(true);
            }
            throw new Error(`Network error calling proxy: ${err instanceof Error ? err.message : "Failed to fetch"}. ` +
                "Check your connection and try again.");
        }
        finally {
            if (timer !== undefined)
                clearTimeout(timer);
            outer?.removeEventListener("abort", onOuterAbort);
        }
    };
    return attempt(false);
}
/** Submit a request to the fal.ai queue. Returns the request_id + URLs. */
async function falQueueSubmit(modelPath, body, signal) {
    const url = `${PROXY_BASE}/${modelPath}?fal_webhook=`;
    const resp = await proxyFetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "x-fal-target-url": `https://queue.fal.run/${modelPath}`,
        },
        body: JSON.stringify(body),
    }, { timeoutMs: 30_000, signal });
    if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        throw new Error(`fal queue submit error ${String(resp.status)}: ${text}`);
    }
    return (await resp.json());
}
/** Poll the queue status until COMPLETED, then fetch & return the result JSON. */
async function falQueuePollResult(modelPath, requestId, opts) {
    const pollInterval = opts?.pollIntervalMs ?? 3_000;
    const timeout = opts?.timeoutMs ?? 300_000;
    const signal = opts?.signal;
    const deadline = Date.now() + timeout;
    // Poll status
    while (Date.now() < deadline) {
        if (signal?.aborted)
            throw new DOMException("Aborted", "AbortError");
        const statusUrl = `${PROXY_BASE}/${modelPath}/requests/${requestId}/status`;
        const statusResp = await proxyFetch(statusUrl, {
            method: "GET",
            headers: {
                "x-fal-target-url": `https://queue.fal.run/${modelPath}/requests/${requestId}/status`,
            },
        }, { timeoutMs: 15_000, signal });
        if (!statusResp.ok) {
            const text = await statusResp.text().catch(() => "");
            throw new Error(`fal queue status error ${String(statusResp.status)}: ${text}`);
        }
        const status = (await statusResp.json());
        console.info(`[fal-queue] ${modelPath} ${requestId}: ${status.status}${status.queue_position != null ? ` (pos ${String(status.queue_position)})` : ""}`);
        if (status.status === "COMPLETED")
            break;
        await new Promise((r) => { setTimeout(r, pollInterval); });
    }
    if (Date.now() >= deadline) {
        throw new Error(`fal queue timed out after ${String(timeout / 1000)}s for ${modelPath}`);
    }
    // Fetch the result
    const resultUrl = `${PROXY_BASE}/${modelPath}/requests/${requestId}`;
    const resultResp = await proxyFetch(resultUrl, {
        method: "GET",
        headers: {
            "x-fal-target-url": `https://queue.fal.run/${modelPath}/requests/${requestId}`,
        },
    }, { timeoutMs: 30_000, signal });
    if (!resultResp.ok) {
        const text = await resultResp.text().catch(() => "");
        throw new Error(`fal queue result error ${String(resultResp.status)}: ${text}`);
    }
    return resultResp.json();
}
/* ── Response validation ─────────────────────────── */
const FalImageSchema = z.object({
    url: z.string().url(),
    content_type: z.string().optional(),
    width: z.number().nullish(),
    height: z.number().nullish(),
});
const FalImg2ImgResponseSchema = z.object({
    images: z.array(FalImageSchema).min(1),
});
/* ── Caller ──────────────────────────────────────── */
export async function runImg2Img(req, signal) {
    const body = {
        image_url: req.imageDataUrl, // will be compressed below if needed
        prompt: req.prompt,
    };
    if (req.strength !== undefined)
        body["strength"] = req.strength;
    if (req.numInferenceSteps !== undefined)
        body["num_inference_steps"] = req.numInferenceSteps;
    if (req.seed !== undefined)
        body["seed"] = req.seed;
    // Estimate overhead of the rest of the JSON body (prompt, params, keys)
    const overhead = JSON.stringify({ ...body, image_url: "" }).length + 128;
    body["image_url"] = await compressDataUrl(req.imageDataUrl, overhead);
    const url = `${PROXY_BASE}/fal-ai/flux/dev/image-to-image`;
    const response = await proxyFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }, { timeoutMs: 120_000, signal });
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`fal proxy error ${String(response.status)}: ${text}`);
    }
    const json = await response.json();
    return FalImg2ImgResponseSchema.parse(json);
}
/**
 * Fetch an image URL and return its bytes as an ArrayBuffer + Blob.
 * Works for both data: URLs and remote http(s): URLs.
 * Uses timeout + retry for remote URLs (fal.media mask downloads etc.).
 */
export async function fetchImageBlob(imageUrl, signal) {
    const resp = imageUrl.startsWith("data:")
        ? await fetch(imageUrl)
        : await proxyFetch(imageUrl, {}, { timeoutMs: 30_000, signal });
    if (!resp.ok) {
        throw new Error(`Failed to fetch image: ${String(resp.status)}`);
    }
    const blob = await resp.blob();
    const buffer = await blob.arrayBuffer();
    return { blob, buffer };
}
const FalSam3MaskMetadataSchema = z.record(z.unknown());
const FalSam3RleResponseSchema = z.object({
    rle: z.union([z.string(), z.array(z.string())]),
    metadata: z.array(FalSam3MaskMetadataSchema).nullable().optional(),
    scores: z.array(z.number()).nullable().optional(),
    boxes: z.array(z.array(z.number())).nullable().optional(),
});
/**
 * Visually distinct colors for segment masks — high-saturation, well-spaced hues.
 * Each entry is [R, G, B].
 */
const SEGMENT_COLORS = [
    [230, 25, 75], // red
    [60, 180, 75], // green
    [0, 130, 200], // blue
    [255, 225, 25], // yellow
    [245, 130, 48], // orange
    [145, 30, 180], // purple
    [70, 240, 240], // cyan
    [240, 50, 230], // magenta
    [210, 245, 60], // lime
    [250, 190, 212], // pink
    [0, 128, 128], // teal
    [220, 190, 255], // lavender
];
/**
 * Render a fal.ai SAM2 RLE mask to a PNG data URL.
 *
 * The RLE format from fal-ai/sam2/image-rle is space-separated
 * (offset, length) pairs in **column-major** (Fortran) order.
 * Pixel index `i` maps to row = i % height, col = Math.floor(i / height).
 *
 * @param colorIndex — selects a distinct color from the palette so each
 *   segment is visually distinguishable. Defaults to 0 (red).
 */
export function rleMaskToDataUrl(rle, width, height, colorIndex) {
    const vals = rle.trim().split(/\s+/).map(Number);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx)
        throw new Error("Canvas 2D context unavailable");
    const imageData = ctx.createImageData(width, height);
    const data = imageData.data;
    const totalPx = width * height;
    const ci = (colorIndex ?? 0) % SEGMENT_COLORS.length;
    const [r, g, b] = SEGMENT_COLORS[ci];
    // Process (offset, length) pairs
    for (let p = 0; p + 1 < vals.length; p += 2) {
        const start = vals[p];
        const len = vals[p + 1];
        for (let j = 0; j < len; j++) {
            const idx = start + j;
            if (idx >= totalPx)
                break;
            // Column-major → row-major conversion
            const row = idx % height;
            const col = Math.floor(idx / height);
            const pixelOffset = (row * width + col) * 4;
            data[pixelOffset] = r; // R
            data[pixelOffset + 1] = g; // G
            data[pixelOffset + 2] = b; // B
            data[pixelOffset + 3] = 200; // A — slightly transparent to see through
        }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL("image/png");
}
/**
 * Run SAM-3 segmentation on an image via the fal.ai proxy.
 * Endpoint: fal-ai/sam-3/image-rle
 * Returns RLE-encoded masks inline. Supports text prompts and native
 * multi-mask return via return_multiple_masks + max_masks.
 */
export async function runSegmentation(req, signal) {
    const body = {
        image_url: req.imageUrl,
    };
    if (req.prompt !== undefined)
        body["prompt"] = req.prompt;
    if (req.pointPrompts !== undefined && req.pointPrompts.length > 0)
        body["point_prompts"] = req.pointPrompts;
    if (req.boxPrompts !== undefined && req.boxPrompts.length > 0)
        body["box_prompts"] = req.boxPrompts;
    if (req.returnMultipleMasks !== undefined)
        body["return_multiple_masks"] = req.returnMultipleMasks;
    if (req.maxMasks !== undefined)
        body["max_masks"] = req.maxMasks;
    if (req.includeScores !== undefined)
        body["include_scores"] = req.includeScores;
    if (req.includeBoxes !== undefined)
        body["include_boxes"] = req.includeBoxes;
    // Estimate overhead of the rest of the JSON body (params, keys, coords)
    const overhead = JSON.stringify({ ...body, image_url: "" }).length + 128;
    body["image_url"] = await compressDataUrl(req.imageUrl, overhead);
    const url = `${PROXY_BASE}/fal-ai/sam-3/image-rle`;
    const response = await proxyFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }, { timeoutMs: 120_000, signal });
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`fal proxy error ${String(response.status)}: ${text}`);
    }
    const json = await response.json();
    if (json && typeof json === "object") {
        const obj = json;
        const rle = obj["rle"];
        console.debug(`[SAM3] response keys: ${Object.keys(obj).join(", ")}, rle: ${Array.isArray(rle) ? `array(${String(rle.length)})` : typeof rle}`);
    }
    return FalSam3RleResponseSchema.parse(json);
}
const FalSam2MaskImageSchema = z.object({
    url: z.string().url(),
    content_type: z.string().nullish(),
    file_name: z.string().nullish(),
    file_size: z.number().nullish(),
    width: z.number().nullish(),
    height: z.number().nullish(),
});
const FalSam2AutoSegmentResponseSchema = z.object({
    combined_mask: FalSam2MaskImageSchema,
    individual_masks: z.array(FalSam2MaskImageSchema),
});
/**
 * Run SAM2 auto-segmentation on an image via the fal.ai proxy.
 * Endpoint: fal-ai/sam2/auto-segment
 * Returns individual mask images as downloadable URLs (not RLE).
 */
export async function runAutoSegment(req, signal) {
    const body = {
        image_url: req.imageUrl,
    };
    if (req.pointsPerSide !== undefined)
        body["points_per_side"] = req.pointsPerSide;
    if (req.predIouThresh !== undefined)
        body["pred_iou_thresh"] = req.predIouThresh;
    if (req.stabilityScoreThresh !== undefined)
        body["stability_score_thresh"] = req.stabilityScoreThresh;
    if (req.minMaskRegionArea !== undefined)
        body["min_mask_region_area"] = req.minMaskRegionArea;
    // Estimate overhead of the rest of the JSON body (params, keys)
    const overhead = JSON.stringify({ ...body, image_url: "" }).length + 128;
    body["image_url"] = await compressDataUrl(req.imageUrl, overhead);
    const url = `${PROXY_BASE}/fal-ai/sam2/auto-segment`;
    const response = await proxyFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }, { timeoutMs: 120_000, signal });
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`fal proxy error ${String(response.status)}: ${text}`);
    }
    const json = await response.json();
    if (json && typeof json === "object") {
        const obj = json;
        const masks = obj["individual_masks"];
        console.info(`[SAM2] auto-segment returned ${Array.isArray(masks) ? String(masks.length) : "?"} individual masks`);
    }
    return FalSam2AutoSegmentResponseSchema.parse(json);
}
export const AI_EDIT_MODELS = [
    { id: "nano-banana", label: "Nano Banana", proxyRoute: "fal-ai/nano-banana/edit", hasStrength: false },
    { id: "flux1-img2img", label: "Flux 1 (img2img)", proxyRoute: "fal-ai/flux/dev/image-to-image", hasStrength: true },
];
export function getAiEditModel(id) {
    const found = AI_EDIT_MODELS.find((m) => m.id === id);
    if (found)
        return found;
    // Default to first model (nano-banana)
    return AI_EDIT_MODELS[0] ?? { id: "nano-banana", label: "Nano Banana", proxyRoute: "fal-ai/nano-banana/edit", hasStrength: false };
}
export async function runNanoBananaEdit(req, signal) {
    const body = {
        prompt: req.prompt,
        image_urls: req.imageDataUrls,
    };
    if (req.numImages !== undefined)
        body["num_images"] = req.numImages;
    if (req.seed !== undefined)
        body["seed"] = req.seed;
    if (req.aspectRatio !== undefined)
        body["aspect_ratio"] = req.aspectRatio;
    if (req.outputFormat !== undefined)
        body["output_format"] = req.outputFormat;
    // Compress each image URL if needed
    const overhead = JSON.stringify({ ...body, image_urls: [] }).length + 128;
    const perImageBudget = Math.max(1, Math.floor((MAX_BODY_BYTES - overhead) / Math.max(req.imageDataUrls.length, 1)));
    const compressed = [];
    for (const url of req.imageDataUrls) {
        compressed.push(await compressDataUrl(url, MAX_BODY_BYTES - perImageBudget));
    }
    body["image_urls"] = compressed;
    const url = `${PROXY_BASE}/fal-ai/nano-banana/edit`;
    const response = await proxyFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }, { timeoutMs: 120_000, signal });
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`fal proxy error ${String(response.status)}: ${text}`);
    }
    const json = await response.json();
    return FalImg2ImgResponseSchema.parse(json);
}
/* ── Alpha Mask Compositing ──────────────────────── */
/**
 * Apply the alpha channel from a mask source image to an output image.
 * Used to remove black backgrounds from AI edit results by re-applying
 * the original slice mask transparency.
 * Returns a PNG data URL.
 */
export async function applyAlphaMask(outputImageUrl, maskSourceUrl, signal) {
    const [outResp, maskResp] = await Promise.all([
        fetchImageBlob(outputImageUrl, signal),
        fetchImageBlob(maskSourceUrl, signal),
    ]);
    const [outBitmap, maskBitmap] = await Promise.all([
        createImageBitmap(outResp.blob),
        createImageBitmap(maskResp.blob),
    ]);
    const w = outBitmap.width;
    const h = outBitmap.height;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx)
        throw new Error("Canvas 2D context unavailable");
    ctx.drawImage(outBitmap, 0, 0, w, h);
    const outData = ctx.getImageData(0, 0, w, h);
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = w;
    maskCanvas.height = h;
    const maskCtx = maskCanvas.getContext("2d");
    if (!maskCtx)
        throw new Error("Canvas 2D context unavailable");
    maskCtx.drawImage(maskBitmap, 0, 0, w, h);
    const maskData = maskCtx.getImageData(0, 0, w, h);
    const od = outData.data;
    const md = maskData.data;
    for (let i = 0; i < od.length; i += 4) {
        od[i + 3] = md[i + 3] ?? 0; // copy alpha channel from mask source
    }
    ctx.putImageData(outData, 0, 0);
    outBitmap.close();
    maskBitmap.close();
    return canvas.toDataURL("image/png");
}
/**
 * Invert the alpha channel of an image: transparent <-> opaque.
 * Used for the "invert mask" feature — swapping which part of the slice
 * is visible vs transparent.
 * Returns a PNG data URL.
 */
export async function invertAlpha(imageUrl, signal) {
    const { blob } = await fetchImageBlob(imageUrl, signal);
    const bitmap = await createImageBitmap(blob);
    const w = bitmap.width;
    const h = bitmap.height;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx)
        throw new Error("Canvas 2D context unavailable");
    ctx.drawImage(bitmap, 0, 0, w, h);
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3] ?? 0;
        data[i + 3] = 255 - a;
    }
    ctx.putImageData(imgData, 0, 0);
    bitmap.close();
    return canvas.toDataURL("image/png");
}
/**
 * Invert a mask and composite with the original image.
 *
 * PNG round-tripping discards RGB data for fully transparent pixels, so simply
 * flipping alpha on a pre-masked image produces black regions. This function
 * takes the original (full) image and the current masked image, inverts the
 * alpha from the masked image, and uses it to cut out the *opposite* region
 * from the original — guaranteeing correct RGB everywhere.
 *
 * When `srcCrop` is provided, the masked image is placed at the correct
 * position within the full-size canvas before inverting. The result is
 * tightly cropped around the inverted foreground with new CropInfo.
 */
export async function invertMaskWithOriginal(originalImageUrl, maskedImageUrl, signal, srcCrop) {
    const [origResp, maskResp] = await Promise.all([
        fetchImageBlob(originalImageUrl, signal),
        fetchImageBlob(maskedImageUrl, signal),
    ]);
    const [origBitmap, maskBitmap] = await Promise.all([
        createImageBitmap(origResp.blob),
        createImageBitmap(maskResp.blob),
    ]);
    const w = origBitmap.width;
    const h = origBitmap.height;
    // Draw the original image (provides correct RGB for all pixels)
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx)
        throw new Error("Canvas 2D context unavailable");
    ctx.drawImage(origBitmap, 0, 0, w, h);
    const origData = ctx.getImageData(0, 0, w, h);
    // Build the alpha channel at full size from the (possibly cropped) mask
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = w;
    maskCanvas.height = h;
    const maskCtx = maskCanvas.getContext("2d");
    if (!maskCtx)
        throw new Error("Canvas 2D context unavailable");
    // Clear to transparent (alpha = 0 everywhere by default)
    maskCtx.clearRect(0, 0, w, h);
    if (srcCrop) {
        // Place the cropped mask at its original position
        maskCtx.drawImage(maskBitmap, srcCrop.cropX, srcCrop.cropY, srcCrop.cropW, srcCrop.cropH);
    }
    else {
        maskCtx.drawImage(maskBitmap, 0, 0, w, h);
    }
    const maskData = maskCtx.getImageData(0, 0, w, h);
    // Apply inverted alpha from the mask onto the original's pixels
    // Also compute tight bounding box of the inverted foreground
    const od = origData.data;
    const md = maskData.data;
    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (let i = 0; i < od.length; i += 4) {
        const invAlpha = 255 - (md[i + 3] ?? 0);
        od[i + 3] = invAlpha;
        if (invAlpha > 0) {
            const pIdx = i / 4;
            const px = pIdx % w;
            const py = Math.floor(pIdx / w);
            if (px < minX)
                minX = px;
            if (px > maxX)
                maxX = px;
            if (py < minY)
                minY = py;
            if (py > maxY)
                maxY = py;
        }
    }
    ctx.putImageData(origData, 0, 0);
    origBitmap.close();
    maskBitmap.close();
    // If the inverted mask has foreground, tightly crop it
    if (maxX >= minX && maxY >= minY) {
        const cropX = minX;
        const cropY = minY;
        const cropW = maxX - minX + 1;
        const cropH = maxY - minY + 1;
        const cropCanvas = document.createElement("canvas");
        cropCanvas.width = cropW;
        cropCanvas.height = cropH;
        const cropCtx = cropCanvas.getContext("2d");
        if (!cropCtx)
            throw new Error("Canvas 2D context unavailable");
        cropCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        return {
            dataUrl: cropCanvas.toDataURL("image/png"),
            crop: { cropX, cropY, cropW, cropH, origW: w, origH: h },
        };
    }
    // No foreground in the inverted mask — return 1×1 transparent
    const tiny = document.createElement("canvas");
    tiny.width = 1;
    tiny.height = 1;
    return {
        dataUrl: tiny.toDataURL("image/png"),
        crop: undefined,
    };
}
/**
 * Combine multiple binary masks into one by union (OR), then apply to the
 * original image, tightly cropped around the mask bounding box.
 * Returns a PNG data URL and the crop metadata for positioning.
 */
export async function combineMasksToOriginal(maskUrls, originalImageUrl, signal) {
    if (maskUrls.length === 0)
        throw new Error("No masks to combine");
    const origResp = await fetchImageBlob(originalImageUrl, signal);
    const origBitmap = await createImageBitmap(origResp.blob);
    const w = origBitmap.width;
    const h = origBitmap.height;
    // Load all masks in parallel
    const maskBlobs = await Promise.all(maskUrls.map((url) => fetchImageBlob(url, signal)));
    const maskBitmaps = await Promise.all(maskBlobs.map((r) => createImageBitmap(r.blob)));
    // Union foreground from all masks
    const combined = new Uint8Array(w * h); // 0 = bg, 1 = fg
    const tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = w;
    tmpCanvas.height = h;
    const tmpCtx = tmpCanvas.getContext("2d");
    if (!tmpCtx)
        throw new Error("Canvas 2D context unavailable");
    for (const mb of maskBitmaps) {
        tmpCtx.clearRect(0, 0, w, h);
        tmpCtx.drawImage(mb, 0, 0, w, h);
        const px = tmpCtx.getImageData(0, 0, w, h).data;
        // Detect mask format (alpha vs brightness)
        let minA = 255, maxA = 0;
        for (let i = 3; i < px.length; i += 4) {
            const a = px[i];
            if (a < minA)
                minA = a;
            if (a > maxA)
                maxA = a;
        }
        const useAlpha = maxA - minA > 64;
        for (let i = 0; i < px.length; i += 4) {
            const isFg = useAlpha
                ? px[i + 3] > 128
                : px[i] > 64 || px[i + 1] > 64 || px[i + 2] > 64;
            if (isFg)
                combined[i / 4] = 1;
        }
        mb.close();
    }
    // Compute tight bounding box of the combined mask
    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (let p = 0; p < combined.length; p++) {
        if (combined[p]) {
            const px = p % w;
            const py = Math.floor(p / w);
            if (px < minX)
                minX = px;
            if (px > maxX)
                maxX = px;
            if (py < minY)
                minY = py;
            if (py > maxY)
                maxY = py;
        }
    }
    // Fallback: if no foreground pixels, return full-size transparent
    if (maxX < minX || maxY < minY) {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        origBitmap.close();
        return {
            dataUrl: canvas.toDataURL("image/png"),
            crop: { cropX: 0, cropY: 0, cropW: w, cropH: h, origW: w, origH: h },
        };
    }
    const cropX = minX;
    const cropY = minY;
    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;
    // Draw the original image, apply mask, then crop
    const fullCanvas = document.createElement("canvas");
    fullCanvas.width = w;
    fullCanvas.height = h;
    const fullCtx = fullCanvas.getContext("2d");
    if (!fullCtx)
        throw new Error("Canvas 2D context unavailable");
    fullCtx.drawImage(origBitmap, 0, 0, w, h);
    const imgData = fullCtx.getImageData(0, 0, w, h);
    const data = imgData.data;
    for (let p = 0; p < combined.length; p++) {
        if (!combined[p]) {
            data[p * 4 + 3] = 0; // transparent where no mask
        }
    }
    fullCtx.putImageData(imgData, 0, 0);
    // Extract the cropped region
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext("2d");
    if (!cropCtx)
        throw new Error("Canvas 2D context unavailable");
    cropCtx.drawImage(fullCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    origBitmap.close();
    return {
        dataUrl: cropCanvas.toDataURL("image/png"),
        crop: { cropX, cropY, cropW, cropH, origW: w, origH: h },
    };
}
const FalTextToImgResponseSchema = z.object({
    images: z.array(FalImageSchema).min(1),
});
export async function runTextToImg(req, signal) {
    const body = {
        prompt: req.prompt,
    };
    if (req.imageSize)
        body["image_size"] = req.imageSize;
    if (req.numInferenceSteps !== undefined)
        body["num_inference_steps"] = req.numInferenceSteps;
    if (req.seed !== undefined)
        body["seed"] = req.seed;
    const url = `${PROXY_BASE}/fal-ai/flux/dev`;
    const response = await proxyFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }, { timeoutMs: 120_000, signal });
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`fal proxy error ${String(response.status)}: ${text}`);
    }
    const json = await response.json();
    return FalTextToImgResponseSchema.parse(json);
}
/* ── Layer Composite Rendering ───────────────────── */
/**
 * Render a composited layer image: draws the source image at the given
 * opacity, preserving the existing alpha (mask) channel.
 * Returns a PNG data URL.
 */
export async function renderLayerComposite(imageUrl, opacity, signal) {
    const { blob } = await fetchImageBlob(imageUrl, signal);
    const bitmap = await createImageBitmap(blob);
    const w = bitmap.width;
    const h = bitmap.height;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx)
        throw new Error("Canvas 2D context unavailable");
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    // Scale alpha channel by opacity
    if (opacity < 1) {
        const imgData = ctx.getImageData(0, 0, w, h);
        const data = imgData.data;
        for (let i = 3; i < data.length; i += 4) {
            data[i] = Math.round(data[i] * opacity);
        }
        ctx.putImageData(imgData, 0, 0);
    }
    return canvas.toDataURL("image/png");
}
/* ── Background Removal (fal-ai/birefnet) ───────── */
const FalBirefnetResponseSchema = z.object({
    image: FalImageSchema,
});
/**
 * Remove the background from an image using BiRefNet via fal.ai.
 * Returns a PNG data URL with transparent background.
 */
export async function runBackgroundRemoval(imageUrl, signal) {
    const body = {
        image_url: imageUrl,
    };
    // Compress data URLs that exceed proxy payload limit
    const overhead = JSON.stringify({ ...body, image_url: "" }).length + 128;
    body["image_url"] = await compressDataUrl(imageUrl, overhead);
    const url = `${PROXY_BASE}/fal-ai/birefnet`;
    const response = await proxyFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    }, { timeoutMs: 120_000, signal });
    if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`BiRefNet proxy error ${String(response.status)}: ${text}`);
    }
    const json = await response.json();
    const parsed = FalBirefnetResponseSchema.parse(json);
    // Convert to data URL to avoid CORS issues
    const { blob } = await fetchImageBlob(parsed.image.url, signal);
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => { resolve(reader.result); };
        reader.onerror = () => { reject(new Error("Failed to convert bg-removed image to data URL")); };
        reader.readAsDataURL(blob);
    });
}
/* ── AI Result Refit: detect mask fit & re-segment ── */
/**
 * Measure how well the AI output's visible content fits the original mask shape.
 *
 * Compares the alpha channels of the AI result and the original masked input.
 * Returns a ratio (0–1) indicating how much of the AI output's non-transparent
 * content overlaps with the original mask. A low value means the AI generated
 * content that spills outside or is significantly different from the original
 * mask shape.
 *
 * @param aiResultUrl - The AI-generated image (after applyAlphaMask).
 * @param originalMaskedUrl - The original masked input sent to the AI.
 * @returns IoU (intersection over union) of the two alpha masks.
 */
export async function measureMaskFit(aiResultUrl, originalMaskedUrl, signal) {
    const [aiResp, origResp] = await Promise.all([
        fetchImageBlob(aiResultUrl, signal),
        fetchImageBlob(originalMaskedUrl, signal),
    ]);
    const [aiBitmap, origBitmap] = await Promise.all([
        createImageBitmap(aiResp.blob),
        createImageBitmap(origResp.blob),
    ]);
    // Use the original's dimensions as reference
    const w = origBitmap.width;
    const h = origBitmap.height;
    const aiCanvas = document.createElement("canvas");
    aiCanvas.width = w;
    aiCanvas.height = h;
    const aiCtx = aiCanvas.getContext("2d");
    if (!aiCtx)
        throw new Error("Canvas 2D context unavailable");
    aiCtx.drawImage(aiBitmap, 0, 0, w, h);
    const aiData = aiCtx.getImageData(0, 0, w, h).data;
    const origCanvas = document.createElement("canvas");
    origCanvas.width = w;
    origCanvas.height = h;
    const origCtx = origCanvas.getContext("2d");
    if (!origCtx)
        throw new Error("Canvas 2D context unavailable");
    origCtx.drawImage(origBitmap, 0, 0, w, h);
    const origData = origCtx.getImageData(0, 0, w, h).data;
    aiBitmap.close();
    origBitmap.close();
    let intersection = 0;
    let union = 0;
    for (let i = 3; i < aiData.length; i += 4) {
        const aiOpaque = aiData[i] > 128;
        const origOpaque = origData[i] > 128;
        if (aiOpaque || origOpaque)
            union++;
        if (aiOpaque && origOpaque)
            intersection++;
    }
    return union > 0 ? intersection / union : 1;
}
/**
 * Post-process an AI edit result for a masked segment.
 *
 * The AI model may generate content that doesn't match the original mask shape
 * (e.g., "make it a cartoon" can change outlines). This function:
 * 1. Re-applies the original alpha mask to the AI result
 * 2. Measures how well the result fits the original mask
 * 3. If fit is poor (IoU < threshold), runs background removal on the raw AI
 *    output to create a fresh mask, then tight-crops the result
 *
 * @returns The processed image data URL and updated crop metadata.
 */
export async function refitAiResult(rawAiOutputUrl, originalMaskedUrl, srcCrop, signal) {
    const FIT_THRESHOLD = 0.65; // IoU below this triggers refit
    // Step 1: Apply original alpha mask to get the "clamped" version
    const clampedUrl = await applyAlphaMask(rawAiOutputUrl, originalMaskedUrl, signal);
    // Step 2: Measure how well the AI content fits the original mask
    const iou = await measureMaskFit(clampedUrl, originalMaskedUrl, signal);
    console.info(`[AI Refit] mask fit IoU = ${(iou * 100).toFixed(1)}%`);
    if (iou >= FIT_THRESHOLD) {
        // Good fit — use the clamped result with original crop
        return { dataUrl: clampedUrl, crop: srcCrop, wasRefit: false };
    }
    // Step 3: Poor fit — run background removal on raw AI output
    console.info("[AI Refit] poor mask fit, running background removal on raw AI output");
    const bgRemovedUrl = await runBackgroundRemoval(rawAiOutputUrl, signal);
    // Step 4: Tight-crop the bg-removed result
    const { blob } = await fetchImageBlob(bgRemovedUrl, signal);
    const bitmap = await createImageBitmap(blob);
    const w = bitmap.width;
    const h = bitmap.height;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx)
        throw new Error("Canvas 2D context unavailable");
    ctx.drawImage(bitmap, 0, 0);
    const imgData = ctx.getImageData(0, 0, w, h);
    const data = imgData.data;
    // Compute tight bounding box from alpha
    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 10) { // threshold slightly above 0 for anti-aliasing
            const pIdx = i / 4;
            const px = pIdx % w;
            const py = Math.floor(pIdx / w);
            if (px < minX)
                minX = px;
            if (px > maxX)
                maxX = px;
            if (py < minY)
                minY = py;
            if (py > maxY)
                maxY = py;
        }
    }
    bitmap.close();
    // Fallback: if no visible pixels, return as-is
    if (maxX < minX || maxY < minY) {
        return { dataUrl: bgRemovedUrl, crop: srcCrop, wasRefit: true };
    }
    const cropX = minX;
    const cropY = minY;
    const cropW = maxX - minX + 1;
    const cropH = maxY - minY + 1;
    // If we have source crop info, compute new crop relative to the original
    // full image. The AI output is at the same size as the cropped input,
    // so we need to map back to original coordinates.
    let newCrop;
    if (srcCrop) {
        // The AI output is srcCrop.cropW × srcCrop.cropH, positioned at
        // srcCrop.cropX, srcCrop.cropY in the original image.
        // The new bounding box within the AI output maps to:
        const scaleX = srcCrop.cropW / w;
        const scaleY = srcCrop.cropH / h;
        newCrop = {
            cropX: srcCrop.cropX + Math.round(cropX * scaleX),
            cropY: srcCrop.cropY + Math.round(cropY * scaleY),
            cropW: Math.round(cropW * scaleX),
            cropH: Math.round(cropH * scaleY),
            origW: srcCrop.origW,
            origH: srcCrop.origH,
        };
    }
    else {
        newCrop = { cropX, cropY, cropW, cropH, origW: w, origH: h };
    }
    // Extract the cropped region
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = cropW;
    cropCanvas.height = cropH;
    const cropCtx = cropCanvas.getContext("2d");
    if (!cropCtx)
        throw new Error("Canvas 2D context unavailable");
    cropCtx.drawImage(canvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    const croppedUrl = cropCanvas.toDataURL("image/png");
    console.info(`[AI Refit] re-cropped: ${String(cropW)}×${String(cropH)} at (${String(newCrop.cropX)},${String(newCrop.cropY)}) in ${String(newCrop.origW)}×${String(newCrop.origH)}`);
    return { dataUrl: croppedUrl, crop: newCrop, wasRefit: true };
}
const FalFileSchema = z.object({
    url: z.string(),
    content_type: z.string().optional(),
    file_name: z.string().optional(),
    file_size: z.number().optional(),
});
/** Accept both flat `[1,2,3]` and nested `[[1,2,3]]` number arrays from SAM-3. */
const flexNumArray = z.union([
    z.array(z.number()),
    z.array(z.array(z.number())),
]);
const FalSam3DMetadataSchema = z.object({
    rotation: flexNumArray.optional(),
    translation: flexNumArray.optional(),
    scale: flexNumArray.optional(),
}).passthrough();
const FalImageTo3DResponseSchema = z.object({
    gaussian_splat: FalFileSchema,
    model_glb: z.union([FalFileSchema, z.string()]).optional(),
    metadata: z.array(FalSam3DMetadataSchema),
    individual_splats: z.array(FalFileSchema).optional(),
    individual_glbs: z.array(FalFileSchema).optional(),
});
/**
 * Run SAM-3 image-to-3D on an image via the fal.ai proxy queue.
 * Uses the async queue pattern: submit → poll status → get result.
 * Endpoint: fal-ai/sam-3/3d-objects
 * Returns GLB mesh + Gaussian splat + per-object metadata.
 */
export async function runImageTo3D(req, signal) {
    const MODEL_PATH = "fal-ai/sam-3/3d-objects";
    const body = {
        image_url: req.imageUrl,
    };
    if (req.maskUrls !== undefined && req.maskUrls.length > 0)
        body["mask_urls"] = req.maskUrls;
    if (req.prompt !== undefined)
        body["prompt"] = req.prompt;
    if (req.exportTexturedGlb !== undefined)
        body["export_textured_glb"] = req.exportTexturedGlb;
    // Compress image_url data URI
    const overhead = JSON.stringify({ ...body, image_url: "" }).length + 128;
    body["image_url"] = await compressDataUrl(req.imageUrl, overhead);
    // Compress mask_urls data URIs
    if (Array.isArray(body["mask_urls"])) {
        const masks = body["mask_urls"];
        const maskBudget = Math.max(1, Math.floor((MAX_BODY_BYTES - overhead) / Math.max(masks.length, 1)));
        const compressed = [];
        for (const m of masks) {
            compressed.push(await compressDataUrl(m, MAX_BODY_BYTES - maskBudget));
        }
        body["mask_urls"] = compressed;
    }
    // 1. Submit to the queue
    console.info("[SAM3-3D] Submitting to queue…");
    const { request_id } = await falQueueSubmit(MODEL_PATH, body, signal);
    console.info(`[SAM3-3D] Queued: request_id=${request_id}`);
    // 2. Poll until complete, then get the result
    const json = await falQueuePollResult(MODEL_PATH, request_id, {
        pollIntervalMs: 4_000,
        timeoutMs: 300_000,
        ...(signal ? { signal } : {}),
    });
    if (json && typeof json === "object") {
        const obj = json;
        console.info("[SAM3-3D] response keys:", Object.keys(obj));
        const meta = obj["metadata"];
        if (Array.isArray(meta)) {
            console.info(`[SAM3-3D] ${String(meta.length)} object(s) in metadata`);
        }
    }
    return FalImageTo3DResponseSchema.parse(json);
}
