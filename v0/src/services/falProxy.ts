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
    image_url: req.imageDataUrl,
    prompt: req.prompt,
  };
  if (req.strength !== undefined) body["strength"] = req.strength;
  if (req.numInferenceSteps !== undefined) body["num_inference_steps"] = req.numInferenceSteps;
  if (req.seed !== undefined) body["seed"] = req.seed;

  const url = `${PROXY_BASE}/fal-ai/flux/dev/image-to-image`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ?? null,
  });

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
 */
export async function fetchImageBlob(
  imageUrl: string,
  signal?: AbortSignal,
): Promise<{ blob: Blob; buffer: ArrayBuffer }> {
  const resp = await fetch(imageUrl, { signal: signal ?? null });
  if (!resp.ok) {
    throw new Error(`Failed to fetch image: ${String(resp.status)}`);
  }
  const blob = await resp.blob();
  const buffer = await blob.arrayBuffer();
  return { blob, buffer };
}
