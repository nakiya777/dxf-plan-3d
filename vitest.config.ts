import { defineConfig } from 'vitest/config';

// 純粋モジュール（dxf / recognize / model / geometry）は Node で試す
export default defineConfig({
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
