/** Operation Registry — defines available operations for image ingest. */
export const OPERATIONS = [
    {
        id: "sam3.segment",
        label: "Image2Slice BrickUI",
        kind: "remote",
        inputs: "image",
        outputs: "segments",
    },
    {
        id: "sam3.image-to-3d",
        label: "Image → 3D Object",
        kind: "remote",
        inputs: "image",
        outputs: "3d",
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
export function getOperation(id) {
    return OPERATIONS.find((op) => op.id === id);
}
