import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../", import.meta.url)) } },
  esbuild: { jsx: "automatic" },
  test: {
    include: ["tests/phone11-auth-client*.test.ts"],
    environment: "node",
  },
});
