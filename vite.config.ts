import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: process.env.VITE_BASE_PATH || '/',
  plugins: [react()],
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-pdf': ['pdf-lib'],
          'vendor-icons': ['lucide-react'],
        },
      },
    },
  },
  server: {
    port: 3680,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3681',
        changeOrigin: true,
      },
    },
  },
});
