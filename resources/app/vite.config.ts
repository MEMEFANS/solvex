import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
export default defineConfig(({ command }) => ({
  root: fileURLToPath(new URL('./frontend', import.meta.url)),
  base: command === 'build' ? '/app/' : '/',
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  plugins: [react(), tailwindcss(), {
    name: 'legacy-public-assets',
    transformIndexHtml: { order: 'post', handler: html => html.replaceAll('/app/styles/', '/styles/').replaceAll('/app/assets/brand/', '/assets/brand/') },
  }],
  experimental: { renderBuiltUrl: (filename, { type }) => type === 'public' ? '/' + filename : undefined },
  resolve: { alias: { '@': fileURLToPath(new URL('./frontend/src', import.meta.url)) } },
  server: { host: '127.0.0.1', port: 5173, proxy: { '/api': process.env.SOLVEX_API_TARGET || 'http://127.0.0.1:5174' } },
  build: {
    outDir: '../public/app', emptyOutDir: true, copyPublicDir: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('lucide-react')) return 'lucide';
            if (id.includes('ethers')) return 'ethers';
            if (id.includes('@radix-ui')) return 'radix';
            if (id.includes('sonner')) return 'sonner';
            if (id.includes('class-variance-authority') || id.includes('clsx') || id.includes('tailwind-merge')) return 'style-utils';
            if (id.includes('@tanstack/react-query')) return 'query';
            if (id.includes('react-dom') || id.includes('/react/') || id.endsWith('/react')) return 'react';
          }
        },
      },
    },
  },
}));
