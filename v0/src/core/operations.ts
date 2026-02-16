/** Operation Registry — defines available operations for image ingest. */

export interface OperationDef {
  id: string;
  label: string;
  kind: "local" | "remote";
  inputs: "image";
  outputs: "segments" | "edges" | "masks" | "none";
  defaultParams?: Record<string, string>;
}

export const OPERATIONS: OperationDef[] = [
  {
    id: "sam3.segment",
    label: "Image2Slice BrickUI",
    kind: "remote",
    inputs: "image",
    outputs: "segments",
  },
  {
    id: "canny.edges",
    label: "Canny Edge Detection",
    kind: "local",
    inputs: "image",
    outputs: "edges",
  },
  {
    id: "none",
    label: "None (place image only)",
    kind: "local",
    inputs: "image",
    outputs: "none",
  },
];

export function getOperation(id: string): OperationDef | undefined {
  return OPERATIONS.find((op) => op.id === id);
}
