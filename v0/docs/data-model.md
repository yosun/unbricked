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
