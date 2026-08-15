import { cloistrViteConfig } from '@cloistr/vite-config';

export default cloistrViteConfig({
  server: {
    port: 3000,
  },
  esbuild: {
    loader: 'jsx',
    include: /src\/.*\.js$/,
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: {
        '.js': 'jsx',
      },
    },
  },
});
