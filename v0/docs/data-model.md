# Canonical Data Model

All persisted objects must be:
- Representable as JSON
- Strictly typed in TS
- Validated by Zod

## Objects

### Space
Enterable container (world, layerspace, objectspace, partspace, etc.)
- id, kind, name, createdAt, meta

### Edge
Relationships:
- containment (parent-child)
- projection (2D view of a 3D space)
- derivation (A derived from B via operator)
- portal (navigational link / enter)

### Payload
Blob references (image, mask, mesh, video, etc.)
- includes content hash + uri (future: S3/CloudFront)

#### Payload.meta — Crop Metadata (CropInfo)

Segment-mask and AI-edit payloads store **tight-crop bounding box** metadata
in `payload.meta`. This means the payload URI is a tightly-cropped image (only
the mask foreground region), not a full-size image with transparent padding.

| Field   | Type     | Description                                  |
|---------|----------|----------------------------------------------|
| `cropX` | `string` | Left edge of crop box in original image (px) |
| `cropY` | `string` | Top edge of crop box in original image (px)  |
| `cropW` | `string` | Width of the cropped region (px)             |
| `cropH` | `string` | Height of the cropped region (px)            |
| `origW` | `string` | Full original image width (px)               |
| `origH` | `string` | Full original image height (px)              |

**TypeScript type:** `CropInfo` (defined in `services/falProxy.ts`) uses
numeric fields; `payload.meta` stores stringified values.

**Producers** (write crop meta):

| Source | File | How |
|--------|------|-----|
| SAM2 segmentation | `operationRunner.ts` → `applyMaskToOriginal()` | Computes tight bbox of mask foreground, crops image, stores crop fields in payload meta |
| Mask picker combine | `App.tsx` → `handleCombineMasks()` → `combineMasksToOriginal()` | Unions multiple masks, tight-crops, stores crop fields |
| Mask invert | `App.tsx` → `handleInvertMask()` → `invertMaskWithOriginal()` | Inverts alpha in full canvas, re-crops inverted region, updates crop fields |
| AI edit | `App.tsx` → `handleAiEdit()` | Propagates source payload's crop meta to AI output payload |

**Consumers** (read crop meta):

| Consumer | File | How |
|----------|------|-----|
| `layerCropInfo` memo | `App.tsx` | Reads `cropX/Y/W/H/origW/H` from payload meta, builds `Record<layerIdx, CropInfo>` |
| `TexturedLayerPlane` | `SpaceViewport.tsx` | Uses `CropInfo` to scale plane geometry and offset position within the 3D prism |
| AI edit input | `App.tsx` → `handleAiEdit()` | `layerTextures[i]` is already the cropped image; AI model receives focused content |

**Data flow:**

```
Original Image (layer 0, full size, no crop meta)
        │
        ▼
  SAM2 auto-segment
        │
        ▼
  applyMaskToOriginal()
  ┌─────────────────────┐
  │ 1. Apply mask alpha  │
  │ 2. Compute tight bbox│
  │ 3. Crop to bbox      │
  │ 4. Return {dataUrl,  │
  │    crop: CropInfo}   │
  └─────────────────────┘
        │
        ▼
  Payload.meta: { cropX, cropY, cropW, cropH, origW, origH, ... }
        │
        ├──▶ layerCropInfo memo ──▶ SpaceViewport (3D plane sizing + offset)
        │
        ├──▶ layerTextures memo ──▶ handleAiEdit (sends cropped image to AI)
        │                                │
        │                                ▼
        │                          AI output payload (inherits crop meta)
        │
        └──▶ handleInvertMask (re-places crop in full canvas, inverts,
                               re-crops with new bbox + new crop meta)
```

### Annotation
Structured metadata attached to any object
- target ref + schema + data

### OperatorRun
Provenance of transformations
- inputs, params, outputs, timestamps, status

### GraphPatch
Validated mutations / history
- baseRevision + ops (domain-aware)

### Manifest
Package integrity
- version + object index + hashes
