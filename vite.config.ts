import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, 'src/index.ts'),
        'game/index': resolve(__dirname, 'src/game/index.ts'),
        'audio/index': resolve(__dirname, 'src/audio/index.ts'),
        'game/AudioSchedulerWorker': resolve(__dirname, 'src/game/AudioSchedulerWorker.ts'),
        'game/GameLoopWorker': resolve(__dirname, 'src/game/GameLoopWorker.ts'),
      },
      formats: ['es', 'cjs'],
    },
    rollupOptions: {
      external: [
        'react',
        'react-dom',
        'react/jsx-runtime',
        'three',
        '@react-three/fiber',
        '@react-three/drei',
        'zustand',
        'lodash',
        '@epic-web/invariant',
        '@rhythm-archive/bms-core',
        /^@rhythm-archive\/bms-core\/.*/,
      ],
    },
    sourcemap: true,
    minify: false,
  },
});
