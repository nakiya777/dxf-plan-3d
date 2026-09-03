import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // 5173 が埋まっていると Vite は黙って 5174 に移り、E2E が別のアプリに繋がる。固定して失敗させる
  server: { port: 5173, strictPort: true },
});
