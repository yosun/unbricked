import { z } from "zod";

/**
 * fal.ai drop-in proxy client.
 *
 * Base URL: https://e23fygjvzd.execute-api.us-east-1.amazonaws.com/prod/
 * The proxy mirrors fal.ai's REST API.
 *
 * img2img route (fal-ai/flux/dev/image-to-image):
 *   POST <base>/fal-ai/flux/dev/image-to-image
 *   Body: JSON { image_url, prompt, strength?, num_inference_steps?, seed? }
 *   Response: { images: [{ url, content_type?, width?, height? }], ... }
 */

const PROXY_BASE = "https://e23fygjvzd.execute-api.us-east-1.amazonaws.com/prod";

/**
 * Max JSON body size (bytes) we allow for proxy requests.
 * API Gateway has a 10 MB limit; we stay well under to leave room for the rest
 * of the JSON payload besides the image.
 */
const MAX_BODY_BYTES = 6 * 1024 * 1024; // 6 MB

/** Max edge (px) when downscaling an image for the proxy. */
const MAX_IMAGE_EDGE = 2048;

/* ── Helpers ──────────────────────────────────────── */

/**
 * Downscale a data: URL image if the resulting JSON body would exceed the proxy
 * payload limit.  Shrinks the longest edge to MAX_IMAGE_EDGE and re-encodes as
 * JPEG at quality 0.85.  Returns the original URL untouched if it's already
 * small enough or isn't a data: URL.
 */
async function compressDataUrl(dataUrl: string, bodyOverhead: number): Promise<string> {
  if (!dataUrl.startsWith("data:")) return dataUrl;

  // Fast check: if the encoded length is already safe, skip compression.
  if (dataUrl.length + bodyOverhead <= MAX_BODY_BYTES) return dataUrl;

  return new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { naturalWidth: w, naturalHeight: h } = img;
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
      if (!ctx) { reject(new Error("Canvas 2D context unavailable")); return; }
      ctx.drawImage(img, 0, 0, w, h);

      // Try progressively lower quality until we fit
      for (const quality of [0.85, 0.7, 0.5]) {
        const compressed = canvas.toDataURL("image/jpeg", quality);
        if (compressed.length + bodyOverhead <= MAX_BODY_BYTES) {
          resolve(compressed);
          return;
        }
      }
      // Last resort — use lowest quality result even if still large
      resolve(canvas.toDataURL("image/jpeg", 0.5));
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
async function proxyFetch(
  url: string,
  init: RequestInit,
  opts?: { timeoutMs?: number; signal?: AbortSignal | undefined },
): Promise<Response> {
  const timeoutMs = opts?.timeoutMs ?? 120_000;
  const outer = opts?.signal;

  const attempt = async (isRetry: boolean): Promise<Response> => {
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
    } catch (err: unknown) {
      // If the caller aborted, propagate immediately
      if (outer?.aborted) throw err;

      // Distinguish timeout from other network errors
      if (controller.signal.aborted && !outer?.aborted) {
        throw new Error(
          `Proxy request timed out after ${String(timeoutMs / 1000)}s — the model may be cold-starting. Please retry.`,
        );
      }

      // Retry once on transient network failures
      if (!isRetry && err instanceof TypeError && /failed to fetch/i.test(err.message)) {
        await new Promise((r) => { setTimeout(r, 2000); });
        return attempt(true);
      }

      throw new Error(
        `Network error calling proxy: ${err instanceof Error ? err.message : "Failed to fetch"}. ` +
        "Check your connection and try again.",
      );
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      outer?.removeEventListener("abort", onOuterAbort);
    }
  };

  return attempt(false);
}

/* ── Request ─────────────────────────────────────── */

export interface Img2ImgRequest {
  imageDataUrl: string; // data: URL of the source image
  prompt: string;
  strength?: number; // 0..1, default ~0.75
  numInferenceSteps?: number;
  seed?: number;
}

/* ── Response validation ─────────────────────────── */

const FalImageSchema = z.object({
  url: z.string().url(),
  content_type: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});

const FalImg2ImgResponseSchema = z.object({
  images: z.array(FalImageSchema).min(1),
});

export type FalImg2ImgResponse = z.infer<typeof FalImg2ImgResponseSchema>;

/* ── Caller ──────────────────────────────────────── */

export async function runImg2Img(
  req: Img2ImgRequest,
  signal?: AbortSignal,
): Promise<FalImg2ImgResponse> {
  const body: Record<string, unknown> = {
    image_url: req.imageDataUrl, // will be compressed below if needed
    prompt: req.prompt,
  };
  if (req.strength !== undefined) body["strength"] = req.strength;
  if (req.numInferenceSteps !== undefined) body["num_inference_steps"] = req.numInferenceSteps;
  if (req.seed !== undefined) body["seed"] = req.seed;

  // Estimate overhead of the rest of the JSON body (prompt, params, keys)
  const overhead = JSON.stringify({ ...body, image_url: "" }).length + 128;
  body["image_url"] = await compressDataUrl(req.imageDataUrl, overhead);

  const url = `${PROXY_BASE}/fal-ai/flux/dev/image-to-image`;

  const response = await proxyFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { timeoutMs: 120_000, signal },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`fal proxy error ${String(response.status)}: ${text}`);
  }

  const json: unknown = await response.json();
  return FalImg2ImgResponseSchema.parse(json);
}

/**
 * Fetch an image URL and return its bytes as an ArrayBuffer + Blob.
 * Works for both data: URLs and remote http(s): URLs.
 * Uses timeout + retry for remote URLs (fal.media mask downloads etc.).
 */
export async function fetchImageBlob(
  imageUrl: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; buffer: ArrayBuffer }> {
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

/* ── SAM-3 Segmentation (fal-ai/sam-3/image-rle) ── */

export interface PointPrompt {
  x: number;
  y: number;
  label: 0 | 1; // 1 = foreground, 0 = background
}

export interface BoxPrompt {
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
}

export interface Sam3RleRequest {
  imageUrl: string;
  /** Text prompt for segmentation (e.g. "all objects"). */
  prompt?: string;
  pointPrompts?: PointPrompt[];
  boxPrompts?: BoxPrompt[];
  /** Return multiple masks (up to max_masks). */
  returnMultipleMasks?: boolean;
  /** Max masks to return when returnMultipleMasks is true. 1–32, default 3. */
  maxMasks?: number;
  /** Include per-mask confidence scores in the response. */
  includeScores?: boolean;
  /** Include per-mask bounding boxes in the response. */
  includeBoxes?: boolean;
}

const FalSam3MaskMetadataSchema = z.record(z.unknown());

const FalSam3RleResponseSchema = z.object({
  rle: z.union([z.string(), z.array(z.string())]),
  metadata: z.array(FalSam3MaskMetadataSchema).nullable().optional(),
  scores: z.array(z.number()).nullable().optional(),
  boxes: z.array(z.array(z.number())).nullable().optional(),
});

export type FalSam3RleResponse = z.infer<typeof FalSam3RleResponseSchema>;

/**
 * Visually distinct colors for segment masks — high-saturation, well-spaced hues.
 * Each entry is [R, G, B].
 */
const SEGMENT_COLORS: [number, number, number][] = [
  [230, 25, 75],    // red
  [60, 180, 75],    // green
  [0, 130, 200],    // blue
  [255, 225, 25],   // yellow
  [245, 130, 48],   // orange
  [145, 30, 180],   // purple
  [70, 240, 240],   // cyan
  [240, 50, 230],   // magenta
  [210, 245, 60],   // lime
  [250, 190, 212],  // pink
  [0, 128, 128],    // teal
  [220, 190, 255],  // lavender
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
export function rleMaskToDataUrl(
  rle: string,
  width: number,
  height: number,
  colorIndex?: number,
): string {
  const vals = rle.trim().split(/\s+/).map(Number);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;
  const totalPx = width * height;

  const ci = (colorIndex ?? 0) % SEGMENT_COLORS.length;
  const [r, g, b] = SEGMENT_COLORS[ci]!;

  // Process (offset, length) pairs
  for (let p = 0; p + 1 < vals.length; p += 2) {
    const start = vals[p]!;
    const len = vals[p + 1]!;
    for (let j = 0; j < len; j++) {
      const idx = start + j;
      if (idx >= totalPx) break;
      // Column-major → row-major conversion
      const row = idx % height;
      const col = Math.floor(idx / height);
      const pixelOffset = (row * width + col) * 4;
      data[pixelOffset] = r;       // R
      data[pixelOffset + 1] = g;   // G
      data[pixelOffset + 2] = b;   // B
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
export async function runSegmentation(
  req: Sam3RleRequest,
  signal?: AbortSignal,
): Promise<FalSam3RleResponse> {
  const body: Record<string, unknown> = {
    image_url: req.imageUrl,
  };
  if (req.prompt !== undefined) body["prompt"] = req.prompt;
  if (req.pointPrompts !== undefined && req.pointPrompts.length > 0) body["point_prompts"] = req.pointPrompts;
  if (req.boxPrompts !== undefined && req.boxPrompts.length > 0) body["box_prompts"] = req.boxPrompts;
  if (req.returnMultipleMasks !== undefined) body["return_multiple_masks"] = req.returnMultipleMasks;
  if (req.maxMasks !== undefined) body["max_masks"] = req.maxMasks;
  if (req.includeScores !== undefined) body["include_scores"] = req.includeScores;
  if (req.includeBoxes !== undefined) body["include_boxes"] = req.includeBoxes;

  // Estimate overhead of the rest of the JSON body (params, keys, coords)
  const overhead = JSON.stringify({ ...body, image_url: "" }).length + 128;
  body["image_url"] = await compressDataUrl(req.imageUrl, overhead);

  const url = `${PROXY_BASE}/fal-ai/sam-3/image-rle`;

  const response = await proxyFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { timeoutMs: 120_000, signal },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`fal proxy error ${String(response.status)}: ${text}`);
  }

  const json: unknown = await response.json();

  // Log the raw response for debugging segmentation issues
  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    const keys = Object.keys(obj);
    console.info("[SAM3] response keys:", keys);
    const rle = obj["rle"];
    if (Array.isArray(rle)) {
      console.info(`[SAM3] rle: array of ${String(rle.length)}, types: [${rle.slice(0, 3).map((v) => typeof v === "string" ? `str(${String(v.length)})` : typeof v).join(", ")}${rle.length > 3 ? ", …" : ""}]`);
    } else if (typeof rle === "string") {
      console.info(`[SAM3] rle: single string, length=${String(rle.length)}, first 120 chars: ${rle.slice(0, 120)}`);
    } else {
      console.warn("[SAM3] rle field unexpected:", typeof rle, JSON.stringify(rle).slice(0, 200));
    }
    // Log any other fields that might contain mask data
    for (const k of keys) {
      if (k !== "rle") {
        const v = obj[k];
        const preview = JSON.stringify(v);
        console.info(`[SAM3] ${k}:`, preview && preview.length > 200 ? preview.slice(0, 200) + "…" : v);
      }
    }
  } else {
    console.warn("[SAM3] unexpected response type:", typeof json);
  }

  return FalSam3RleResponseSchema.parse(json);
}

/* ── SAM2 Auto-Segment (fal-ai/sam2/auto-segment) ── */

export interface Sam2AutoSegmentRequest {
  imageUrl: string;
  /** Number of points per side for the grid prompt. Default 32. */
  pointsPerSide?: number;
  /** IoU threshold for predicted masks. Default 0.88. */
  predIouThresh?: number;
  /** Stability score threshold for masks. Default 0.95. */
  stabilityScoreThresh?: number;
  /** Minimum mask region area in pixels. Default 100. */
  minMaskRegionArea?: number;
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

export type FalSam2AutoSegmentResponse = z.infer<typeof FalSam2AutoSegmentResponseSchema>;

/**
 * Run SAM2 auto-segmentation on an image via the fal.ai proxy.
 * Endpoint: fal-ai/sam2/auto-segment
 * Returns individual mask images as downloadable URLs (not RLE).
 */
export async function runAutoSegment(
  req: Sam2AutoSegmentRequest,
  signal?: AbortSignal,
): Promise<FalSam2AutoSegmentResponse> {
  const body: Record<string, unknown> = {
    image_url: req.imageUrl,
  };
  if (req.pointsPerSide !== undefined) body["points_per_side"] = req.pointsPerSide;
  if (req.predIouThresh !== undefined) body["pred_iou_thresh"] = req.predIouThresh;
  if (req.stabilityScoreThresh !== undefined) body["stability_score_thresh"] = req.stabilityScoreThresh;
  if (req.minMaskRegionArea !== undefined) body["min_mask_region_area"] = req.minMaskRegionArea;

  // Estimate overhead of the rest of the JSON body (params, keys)
  const overhead = JSON.stringify({ ...body, image_url: "" }).length + 128;
  body["image_url"] = await compressDataUrl(req.imageUrl, overhead);

  const url = `${PROXY_BASE}/fal-ai/sam2/auto-segment`;

  const response = await proxyFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { timeoutMs: 120_000, signal },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`fal proxy error ${String(response.status)}: ${text}`);
  }

  const json: unknown = await response.json();

  if (json && typeof json === "object") {
    const obj = json as Record<string, unknown>;
    const masks = obj["individual_masks"];
    console.info(`[SAM2] auto-segment returned ${Array.isArray(masks) ? String(masks.length) : "?"} individual masks`);
  }

  return FalSam2AutoSegmentResponseSchema.parse(json);
}

/* ── AI Edit Model Registry ───────────────────── */

export type AiEditModelId = "nano-banana" | "flux1-img2img";

export interface AiEditModelDef {
  id: AiEditModelId;
  label: string;
  proxyRoute: string;
  hasStrength: boolean;
}

export const AI_EDIT_MODELS: AiEditModelDef[] = [
  { id: "nano-banana", label: "Nano Banana", proxyRoute: "fal-ai/nano-banana/edit", hasStrength: false },
  { id: "flux1-img2img", label: "Flux 1 (img2img)", proxyRoute: "fal-ai/flux/dev/image-to-image", hasStrength: true },
];

export function getAiEditModel(id: string): AiEditModelDef {
  const found = AI_EDIT_MODELS.find((m) => m.id === id);
  if (found) return found;
  // Default to first model (nano-banana)
  return AI_EDIT_MODELS[0] ?? { id: "nano-banana" as AiEditModelId, label: "Nano Banana", proxyRoute: "fal-ai/nano-banana/edit", hasStrength: false };
}

/* ── Nano Banana Edit (fal-ai/nano-banana/edit) ── */

export interface NanoBananaEditRequest {
  imageDataUrls: string[];
  prompt: string;
  numImages?: number;
  seed?: number;
  aspectRatio?: string;
  outputFormat?: "jpeg" | "png" | "webp";
}

export async function runNanoBananaEdit(
  req: NanoBananaEditRequest,
  signal?: AbortSignal,
): Promise<FalImg2ImgResponse> {
  const body: Record<string, unknown> = {
    prompt: req.prompt,
    image_urls: req.imageDataUrls,
  };
  if (req.numImages !== undefined) body["num_images"] = req.numImages;
  if (req.seed !== undefined) body["seed"] = req.seed;
  if (req.aspectRatio !== undefined) body["aspect_ratio"] = req.aspectRatio;
  if (req.outputFormat !== undefined) body["output_format"] = req.outputFormat;

  // Compress each image URL if needed
  const overhead = JSON.stringify({ ...body, image_urls: [] }).length + 128;
  const perImageBudget = Math.max(1, Math.floor((MAX_BODY_BYTES - overhead) / Math.max(req.imageDataUrls.length, 1)));
  const compressed: string[] = [];
  for (const url of req.imageDataUrls) {
    compressed.push(await compressDataUrl(url, MAX_BODY_BYTES - perImageBudget));
  }
  body["image_urls"] = compressed;

  const url = `${PROXY_BASE}/fal-ai/nano-banana/edit`;

  const response = await proxyFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { timeoutMs: 120_000, signal },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`fal proxy error ${String(response.status)}: ${text}`);
  }

  const json: unknown = await response.json();
  return FalImg2ImgResponseSchema.parse(json);
}

/* ── Alpha Mask Compositing ──────────────────────── */

/**
 * Apply the alpha channel from a mask source image to an output image.
 * Used to remove black backgrounds from AI edit results by re-applying
 * the original slice mask transparency.
 * Returns a PNG data URL.
 */
export async function applyAlphaMask(
  outputImageUrl: string,
  maskSourceUrl: string,
  signal?: AbortSignal,
): Promise<string> {
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
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.drawImage(outBitmap, 0, 0, w, h);
  const outData = ctx.getImageData(0, 0, w, h);

  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = w;
  maskCanvas.height = h;
  const maskCtx = maskCanvas.getContext("2d");
  if (!maskCtx) throw new Error("Canvas 2D context unavailable");
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
export async function invertAlpha(
  imageUrl: string,
  signal?: AbortSignal,
): Promise<string> {
  const { blob } = await fetchImageBlob(imageUrl, signal);
  const bitmap = await createImageBitmap(blob);

  const w = bitmap.width;
  const h = bitmap.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

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
 */
export async function invertMaskWithOriginal(
  originalImageUrl: string,
  maskedImageUrl: string,
  signal?: AbortSignal,
): Promise<string> {
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
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(origBitmap, 0, 0, w, h);
  const origData = ctx.getImageData(0, 0, w, h);

  // Read the masked image to get its alpha channel
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = w;
  maskCanvas.height = h;
  const maskCtx = maskCanvas.getContext("2d");
  if (!maskCtx) throw new Error("Canvas 2D context unavailable");
  maskCtx.drawImage(maskBitmap, 0, 0, w, h);
  const maskData = maskCtx.getImageData(0, 0, w, h);

  // Apply inverted alpha from the masked image onto the original's pixels
  const od = origData.data;
  const md = maskData.data;
  for (let i = 0; i < od.length; i += 4) {
    od[i + 3] = 255 - (md[i + 3] ?? 0);
  }

  ctx.putImageData(origData, 0, 0);
  origBitmap.close();
  maskBitmap.close();
  return canvas.toDataURL("image/png");
}

/** Crop bounding box returned alongside the combined mask image. */
export interface CropInfo {
  /** Left edge of the crop box in the original image (px). */
  cropX: number;
  /** Top edge of the crop box in the original image (px). */
  cropY: number;
  /** Width of the cropped region (px). */
  cropW: number;
  /** Height of the cropped region (px). */
  cropH: number;
  /** Full original image width (px). */
  origW: number;
  /** Full original image height (px). */
  origH: number;
}

/**
 * Combine multiple binary masks into one by union (OR), then apply to the
 * original image, tightly cropped around the mask bounding box.
 * Returns a PNG data URL and the crop metadata for positioning.
 */
export async function combineMasksToOriginal(
  maskUrls: string[],
  originalImageUrl: string,
  signal?: AbortSignal,
): Promise<{ dataUrl: string; crop: CropInfo }> {
  if (maskUrls.length === 0) throw new Error("No masks to combine");

  const origResp = await fetchImageBlob(originalImageUrl, signal);
  const origBitmap = await createImageBitmap(origResp.blob);
  const w = origBitmap.width;
  const h = origBitmap.height;

  // Load all masks in parallel
  const maskBlobs = await Promise.all(
    maskUrls.map((url) => fetchImageBlob(url, signal)),
  );
  const maskBitmaps = await Promise.all(
    maskBlobs.map((r) => createImageBitmap(r.blob)),
  );

  // Union foreground from all masks
  const combined = new Uint8Array(w * h); // 0 = bg, 1 = fg
  const tmpCanvas = document.createElement("canvas");
  tmpCanvas.width = w;
  tmpCanvas.height = h;
  const tmpCtx = tmpCanvas.getContext("2d");
  if (!tmpCtx) throw new Error("Canvas 2D context unavailable");

  for (const mb of maskBitmaps) {
    tmpCtx.clearRect(0, 0, w, h);
    tmpCtx.drawImage(mb, 0, 0, w, h);
    const px = tmpCtx.getImageData(0, 0, w, h).data;

    // Detect mask format (alpha vs brightness)
    let minA = 255, maxA = 0;
    for (let i = 3; i < px.length; i += 4) {
      const a = px[i]!;
      if (a < minA) minA = a;
      if (a > maxA) maxA = a;
    }
    const useAlpha = maxA - minA > 64;

    for (let i = 0; i < px.length; i += 4) {
      const isFg = useAlpha
        ? px[i + 3]! > 128
        : px[i]! > 64 || px[i + 1]! > 64 || px[i + 2]! > 64;
      if (isFg) combined[i / 4] = 1;
    }
    mb.close();
  }

  // Compute tight bounding box of the combined mask
  let minX = w, minY = h, maxX = 0, maxY = 0;
  for (let p = 0; p < combined.length; p++) {
    if (combined[p]) {
      const px = p % w;
      const py = Math.floor(p / w);
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
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
  if (!fullCtx) throw new Error("Canvas 2D context unavailable");
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
  if (!cropCtx) throw new Error("Canvas 2D context unavailable");
  cropCtx.drawImage(fullCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

  origBitmap.close();
  return {
    dataUrl: cropCanvas.toDataURL("image/png"),
    crop: { cropX, cropY, cropW, cropH, origW: w, origH: h },
  };
}

/* ── Text-to-Image (fal-ai/flux/dev) ───────────── */

export interface TextToImgRequest {
  prompt: string;
  imageSize?: { width: number; height: number };
  numInferenceSteps?: number;
  seed?: number;
}

const FalTextToImgResponseSchema = z.object({
  images: z.array(FalImageSchema).min(1),
});

export async function runTextToImg(
  req: TextToImgRequest,
  signal?: AbortSignal,
): Promise<FalImg2ImgResponse> {
  const body: Record<string, unknown> = {
    prompt: req.prompt,
  };
  if (req.imageSize) body["image_size"] = req.imageSize;
  if (req.numInferenceSteps !== undefined) body["num_inference_steps"] = req.numInferenceSteps;
  if (req.seed !== undefined) body["seed"] = req.seed;

  const url = `${PROXY_BASE}/fal-ai/flux/dev`;

  const response = await proxyFetch(
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { timeoutMs: 120_000, signal },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`fal proxy error ${String(response.status)}: ${text}`);
  }

  const json: unknown = await response.json();
  return FalTextToImgResponseSchema.parse(json);
}
