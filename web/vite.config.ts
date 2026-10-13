import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { env } from 'node:process';
export default defineConfig({
  plugins: [vue()],
  server: { port: Number(env.WEB_PORT ?? 5173), strictPort: true, proxy: { '/api': `http://127.0.0.1:${env.PORT ?? 3001}` }, fs: { allow: ['..'] } },
});
