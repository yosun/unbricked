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
