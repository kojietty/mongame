import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // 開発中はAPI(Worker)へプロキシしてCookieを同一オリジン扱いにする
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true, rewrite: p => p.replace(/^\/api/, "") },
      "/auth": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
});
