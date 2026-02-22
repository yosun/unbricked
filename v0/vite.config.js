import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
export default defineConfig({
    plugins: [react()],
    resolve: {
        extensions: [".tsx", ".ts", ".jsx", ".js", ".mjs", ".mts", ".json"],
    },
});
