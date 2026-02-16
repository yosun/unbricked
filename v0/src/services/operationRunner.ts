/**
 * Operation Runner — executes default operations on images after ingest.
 *
 * SAM3 segmentation calls the real fal.ai proxy endpoint and maps returned
 * segment masks onto BrickUI layers (one mask per layer, original image on
 * layer 0). The Space's layerCount is updated and each mask becomes a Payload
 * + render-annotation mapping.
 */

import type { OperationDef } from "../core/operations";
import type {
  SpaceId,
  PayloadId,
  OperatorRunId,
  GraphPatchOp,
  JsonObject,
  ProjectState,
  AnnotationId,
} from "../core";
import { makeId, putOp } from "../core";
import { runAutoSegment, fetchImageBlob } from "./falProxy";
import { sha256Hex } from "../core";

export type OperationProgress =
  | { phase: "queued" }
  | { phase: "running"; label: string }
  | { phase: "succeeded"; oprunId: OperatorRunId; ops: GraphPatchOp[]; maskCount: number }
  | { phase: "succeeded-warning"; oprunId: OperatorRunId; ops: GraphPatchOp[]; warning: string }
  | { phase: "failed"; error: string };

export interface OperationContext {
  /** Current project state — needed to read the image URI and existing annotations. */
  state: ProjectState;
  /** Natural width/height of the source image — used to construct full-image box prompt. */
  imageWidth: number;
  imageHeight: number;
}

/**
 * Run an operation on a placed image.
 * Returns the patch ops needed to record the OperatorRun, derived payloads,
 * updated space layerCount, and render annotation mappings.
 */
export async function runOperation(
  op: OperationDef,
  spaceId: SpaceId,
  payloadId: PayloadId,
  ctx: OperationContext,
  signal?: AbortSignal,
): Promise<{ oprunId: OperatorRunId; ops: GraphPatchOp[]; maskCount?: number; maskPayloadIds?: PayloadId[] }> {
  if (op.id === "none") {
    const oprunId = makeId("oprun");
    const oprunValue: JsonObject = {
      id: oprunId,
      kind: "OperatorRun",
      operator: "none",
      status: "succeeded",
      createdAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      inputs: [{ kind: "Payload", id: payloadId }],
      outputs: [],
      params: {},
    };
    return { oprunId, ops: [putOp("OperatorRun", oprunId, oprunValue)] };
  }

  if (op.id === "sam3.segment") {
    return runSam3Segment(op, spaceId, payloadId, ctx, signal);
  }

  // Fallback for unknown operations — no-op with provenance
  const oprunId = makeId("oprun");
  const oprunValue: JsonObject = {
    id: oprunId,
    kind: "OperatorRun",
    operator: op.id,
    status: "succeeded",
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    inputs: [{ kind: "Payload", id: payloadId }],
    outputs: [],
    params: {},
  };
  return { oprunId, ops: [putOp("OperatorRun", oprunId, oprunValue)] };
}

/* ── SAM2 Auto-Segment ──────────────────────────── */

/**
 * Colorize a binary mask image (white-on-black) with a distinct segment color.
 * Downloads the mask, paints non-black pixels with the indexed color, returns
 * a PNG data URL.
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

async function colorizeMask(
  maskUrl: string,
  colorIndex: number,
  signal?: AbortSignal,
): Promise<string> {
  const { blob } = await fetchImageBlob(maskUrl, signal);
  const bitmap = await createImageBitmap(blob);

  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");

  ctx.drawImage(bitmap, 0, 0);
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const data = imageData.data;

  const ci = colorIndex % SEGMENT_COLORS.length;
  const [r, g, b] = SEGMENT_COLORS[ci]!;

  // First pass: detect if the mask uses alpha variation.
  // SAM2 returns 8-bit grayscale PNGs (no alpha). When decoded to RGBA,
  // every pixel gets alpha=255 uniformly. Without this check the old
  // "alphaOnly" heuristic would treat all-black background pixels as
  // foreground (since alpha > 128 everywhere), producing solid-colored
  // rectangles instead of actual mask shapes.
  let minAlpha = 255;
  let maxAlpha = 0;
  for (let i = 3; i < data.length; i += 4) {
    const a = data[i]!;
    if (a < minAlpha) minAlpha = a;
    if (a > maxAlpha) maxAlpha = a;
  }
  const useAlpha = maxAlpha - minAlpha > 64;

  // Second pass: colorize foreground pixels.
  let fgCount = 0;
  for (let i = 0; i < data.length; i += 4) {
    const rVal = data[i]!;
    const gVal = data[i + 1]!;
    const bVal = data[i + 2]!;
    const aVal = data[i + 3]!;
    const isForeground = useAlpha
      ? aVal > 128                                       // alpha-based mask
      : rVal > 64 || gVal > 64 || bVal > 64;            // brightness-based mask
    if (isForeground) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 200; // semi-transparent
      fgCount++;
    } else {
      data[i + 3] = 0; // fully transparent background
    }
  }

  ctx.putImageData(imageData, 0, 0);
  bitmap.close();
  return canvas.toDataURL("image/png");
}

/**
 * Apply a binary mask to the original image: keep original pixels where
 * the mask is foreground, make everything else transparent.
 * Returns a PNG data URL.
 */
async function applyMaskToOriginal(
  maskUrl: string,
  originalBitmap: ImageBitmap,
  signal?: AbortSignal,
): Promise<string> {
  const { blob } = await fetchImageBlob(maskUrl, signal);
  const maskBitmap = await createImageBitmap(blob);

  const w = originalBitmap.width;
  const h = originalBitmap.height;

  // Draw the original image
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(originalBitmap, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);

  // Draw the mask (scaled to original size if needed)
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = w;
  maskCanvas.height = h;
  const maskCtx = maskCanvas.getContext("2d");
  if (!maskCtx) throw new Error("Canvas 2D context unavailable");
  maskCtx.drawImage(maskBitmap, 0, 0, w, h);
  const maskData = maskCtx.getImageData(0, 0, w, h);

  // Detect mask format (brightness vs alpha)
  const mPx = maskData.data;
  let minAlpha = 255;
  let maxAlpha = 0;
  for (let i = 3; i < mPx.length; i += 4) {
    const a = mPx[i]!;
    if (a < minAlpha) minAlpha = a;
    if (a > maxAlpha) maxAlpha = a;
  }
  const useAlpha = maxAlpha - minAlpha > 64;

  const data = imgData.data;
  for (let i = 0; i < data.length; i += 4) {
    const mR = mPx[i]!;
    const mG = mPx[i + 1]!;
    const mB = mPx[i + 2]!;
    const mA = mPx[i + 3]!;
    const isForeground = useAlpha
      ? mA > 128
      : mR > 64 || mG > 64 || mB > 64;
    if (!isForeground) {
      data[i + 3] = 0; // transparent where mask is background
    }
  }

  ctx.putImageData(imgData, 0, 0);
  maskBitmap.close();
  return canvas.toDataURL("image/png");
}

async function runSam3Segment(
  op: OperationDef,
  spaceId: SpaceId,
  payloadId: PayloadId,
  ctx: OperationContext,
  signal?: AbortSignal,
): Promise<{ oprunId: OperatorRunId; ops: GraphPatchOp[]; maskCount: number; maskPayloadIds: PayloadId[] }> {
  const payload = ctx.state.payloads[payloadId];
  if (!payload) throw new Error("Source payload not found");

  const space = ctx.state.spaces[spaceId];
  if (!space) throw new Error("Space not found");

  // 1. Run SAM2 auto-segmentation — true automatic segmentation, no prompts needed


  const segResult = await runAutoSegment(
    { imageUrl: payload.uri },
    signal,
  );

  const allMasks = segResult.individual_masks;
  console.info(`[SAM2] auto-segment returned ${String(allMasks.length)} individual masks`);

  // Zero segments is valid — the image simply stays as a single layer.
  if (allMasks.length === 0) {
    const oprunId = makeId("oprun");
    const oprunValue: JsonObject = {
      id: oprunId,
      kind: "OperatorRun",
      operator: op.id,
      status: "succeeded",
      createdAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      inputs: [{ kind: "Payload", id: payloadId }],
      outputs: [],
      params: {
        proxyRoute: "fal-ai/sam2/auto-segment",
        maskCount: "0",
        note: "No segments detected",
      },
    };
    return { oprunId, ops: [putOp("OperatorRun", oprunId, oprunValue)], maskCount: 0, maskPayloadIds: [] };
  }

  const totalPixels = ctx.imageWidth * ctx.imageHeight;

  // 2. Pre-analyze every mask: download and count foreground pixels to compute
  //    area fraction.  This lets us filter out tiny noise masks and sort by size
  //    so large backgrounds end up on the back layers and smaller subjects float
  //    to the front of the 3D prism.
  const MIN_AREA_FRACTION = 0.01; // skip masks covering less than 1% of the image

  interface MaskInfo { idx: number; url: string; fgPixels: number; blob: Blob; width: number; height: number }
  const analyzed: MaskInfo[] = [];

  for (let idx = 0; idx < allMasks.length; idx++) {
    const mask = allMasks[idx]!;
    const { blob } = await fetchImageBlob(mask.url, signal);
    const bitmap = await createImageBitmap(blob);
    const w = ctx.imageWidth;
    const h = ctx.imageHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext("2d");
    if (!c) throw new Error("Canvas 2D context unavailable");
    c.drawImage(bitmap, 0, 0, w, h);
    const px = c.getImageData(0, 0, w, h).data;
    bitmap.close();

    // Detect alpha-vs-brightness (same logic as colorizeMask / applyMaskToOriginal)
    let minA = 255, maxA = 0;
    for (let i = 3; i < px.length; i += 4) {
      const a = px[i]!;
      if (a < minA) minA = a;
      if (a > maxA) maxA = a;
    }
    const useAlpha = maxA - minA > 64;

    let fg = 0;
    for (let i = 0; i < px.length; i += 4) {
      const isFg = useAlpha
        ? px[i + 3]! > 128
        : px[i]! > 64 || px[i + 1]! > 64 || px[i + 2]! > 64;
      if (isFg) fg++;
    }

    const frac = fg / totalPixels;
    console.info(`[SAM2] mask ${String(idx)}: ${String(fg)}/${String(totalPixels)} fg pixels (${(frac * 100).toFixed(1)}%)`);
    if (frac >= MIN_AREA_FRACTION) {
      analyzed.push({ idx, url: mask.url, fgPixels: fg, blob, width: mask.width ?? ctx.imageWidth, height: mask.height ?? ctx.imageHeight });
    } else {
      console.info(`[SAM2] mask ${String(idx)} skipped — below ${String(MIN_AREA_FRACTION * 100)}% area threshold`);
    }
  }

  // Sort by area descending: large background segments → back layers (low index),
  // small subject segments → front layers (high index in the 3D prism).
  analyzed.sort((a, b) => b.fgPixels - a.fgPixels);

  // Cap masks to a reasonable limit for the brick UI
  const MAX_SLICES = 8;
  const masks = analyzed.slice(0, MAX_SLICES);
  console.info(`[SAM2] keeping ${String(masks.length)} masks after area filter + cap`);

  if (masks.length === 0) {
    const oprunId = makeId("oprun");
    const oprunValue: JsonObject = {
      id: oprunId,
      kind: "OperatorRun",
      operator: op.id,
      status: "succeeded",
      createdAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      inputs: [{ kind: "Payload", id: payloadId }],
      outputs: [],
      params: {
        proxyRoute: "fal-ai/sam2/auto-segment",
        maskCount: "0",
        note: "All segments below minimum area threshold",
      },
    };
    return { oprunId, ops: [putOp("OperatorRun", oprunId, oprunValue)], maskCount: 0, maskPayloadIds: [] };
  }

  // Load the original image bitmap once for compositing masks
  const origResponse = await fetch(payload.uri);
  const origBlob = await origResponse.blob();
  const originalBitmap = await createImageBitmap(origBlob);

  const ops: GraphPatchOp[] = [];
  const outputPayloadIds: PayloadId[] = [];

  // 3. Download each mask, generate both masked-original and colored variants.
  for (let idx = 0; idx < masks.length; idx++) {
    const mask = masks[idx]!;

    const [maskedUrl, coloredUrl] = await Promise.all([
      applyMaskToOriginal(mask.url, originalBitmap, signal),
      colorizeMask(mask.url, idx, signal),
    ]);
    const encoder = new TextEncoder();
    const bytes = encoder.encode(maskedUrl);
    const hash = await sha256Hex(bytes.buffer as ArrayBuffer);
    const maskPayloadId = makeId("payload");

    const maskPayloadValue: JsonObject = {
      id: maskPayloadId,
      kind: "Payload",
      mediaType: "image/png",
      uri: maskedUrl,
      sha256: hash,
      bytes: bytes.byteLength,
      meta: {
        width: String(mask.width),
        height: String(mask.height),
        sourcePayloadId: payloadId,
        segmentIndex: String(outputPayloadIds.length),
        colorUri: coloredUrl,
      },
    };

    ops.push(putOp("Payload", maskPayloadId, maskPayloadValue));
    outputPayloadIds.push(maskPayloadId);
  }

  originalBitmap.close();

  // 3. Update Space layerCount: layer 0 = original image, layers 1..N = masks
  const newLayerCount = 1 + outputPayloadIds.length;
  const updatedSpace: JsonObject = {
    ...space,
    layerCount: newLayerCount,
  };
  ops.push(putOp("Space", spaceId, updatedSpace));

  // 4. Create OperatorRun for provenance
  // NOTE: The render annotation (ui.layers.render) is NOT built here.
  // It is built by the caller (handleIngestCommit) inside its commitPatch
  // updater, where `prev` is guaranteed to be the latest state with the
  // correct annotation ID. Building it here from ctx.state (a snapshot)
  // causes a race condition where the annotation ID can mismatch.
  const oprunId = makeId("oprun");
  const oprunValue: JsonObject = {
    id: oprunId,
    kind: "OperatorRun",
    operator: op.id,
    status: "succeeded",
    createdAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    inputs: [{ kind: "Payload", id: payloadId }],
    outputs: outputPayloadIds.map((pid) => ({ kind: "Payload", id: pid })),
    params: {
      proxyRoute: "fal-ai/sam2/auto-segment",
      maskCount: String(outputPayloadIds.length),
    },
  };
  ops.push(putOp("OperatorRun", oprunId, oprunValue));

  // 6. Result annotation
  const annId = makeId("annotation");
  const annValue: JsonObject = {
    id: annId,
    kind: "Annotation",
    target: { kind: "Space", id: spaceId },
    schema: "op.result",
    data: {
      operatorRunId: oprunId,
      operator: op.id,
      status: "succeeded",
      maskCount: String(outputPayloadIds.length),
    },
    createdAt: new Date().toISOString(),
  };
  ops.push(putOp("Annotation", annId, annValue));

  return { oprunId, ops, maskCount: outputPayloadIds.length, maskPayloadIds: outputPayloadIds };
}
