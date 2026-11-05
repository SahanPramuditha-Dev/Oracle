import { defineConfig, Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';

function vadStaticMiddleware(): Plugin {
  return {
    name: 'vad-static-middleware',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ? req.url.split('?')[0] : '';
        if (url.startsWith('/vad/')) {
          const relativePath = url.slice(1);
          const filePath = path.resolve(__dirname, 'public', relativePath);
          const assetRoot = path.resolve(__dirname, 'public/vad') + path.sep;
          if (filePath.startsWith(assetRoot) && /\.(wasm|mjs|js|onnx)$/.test(filePath) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            if (url.endsWith('.wasm')) {
              res.setHeader('Content-Type', 'application/wasm');
            } else if (url.endsWith('.mjs') || url.endsWith('.js')) {
              res.setHeader('Content-Type', 'application/javascript');
            } else if (url.endsWith('.onnx')) {
              res.setHeader('Content-Type', 'application/octet-stream');
            }
            return fs.createReadStream(filePath).pipe(res);
          }
        }
        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), vadStaticMiddleware()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless'
    },
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (request, incoming) => {
            const origin = incoming.headers.origin;
            const permitted = !origin || ['http://127.0.0.1:5173','http://localhost:5173'].includes(origin);
            if (permitted && incoming.headers['x-oracle-client'] === 'web') {
              request.setHeader('Authorization', `Bearer ${fs.readFileSync(path.resolve(__dirname,'../data/dev/api-token'),'utf8').trim()}`);
            }
          });
        }
      }
    }
  },
  build: {
    target: 'esnext',
    outDir: 'dist',
    emptyOutDir: false,
    assetsDir: 'assets',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
          vendor: ['react', 'react-dom', 'framer-motion', 'lucide-react']
        }
      }
    }
  }
});
