import { sites } from '@openai/sites-vite-plugin';
import tailwindcss from '@tailwindcss/postcss';
import vinext from 'vinext';
import { defineConfig, type ProxyOptions } from 'vite';
import { existsSync, readFileSync } from 'node:fs';

const SITE_CREATOR_PLACEHOLDER_DATABASE_ID =
  '00000000-0000-4000-8000-000000000000';

// La configuración del editor es opcional al clonar o descomprimir el proyecto.
// Firebase Hosting no utiliza estos enlaces de almacenamiento de Cloudflare.
const hostingConfigPath = new URL('./.openai/hosting.json', import.meta.url);
const hostingConfig = existsSync(hostingConfigPath)
  ? JSON.parse(readFileSync(hostingConfigPath, 'utf8')) as { d1?: string | null; r2?: string | null }
  : {};
const { d1 = null, r2 = null } = hostingConfig;

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === 'seatbelt';

const localBindingConfig = {
  main: 'vinext/server/fetch-handler',
  compatibility_flags: ['nodejs_compat'],
  d1_databases: d1
    ? [
        {
          binding: d1,
          database_name: 'site-creator-d1',
          database_id: SITE_CREATOR_PLACEHOLDER_DATABASE_ID,
        },
      ]
    : [],
  r2_buckets: r2
    ? [
        {
          binding: r2,
          bucket_name: 'site-creator-r2',
        },
      ]
    : [],
};

export default defineConfig(async () => {
  // Keep Wrangler and Miniflare state project-local. These are non-secret tool
  // settings; application environment belongs in ignored `.env*` files.
  process.env.WRANGLER_WRITE_LOGS ??= 'false';
  process.env.WRANGLER_LOG_PATH ??= '.wrangler/logs';
  process.env.MINIFLARE_REGISTRY_PATH ??= '.wrangler/registry';

  // Wrangler snapshots its log path while the Cloudflare plugin is imported.
  const { cloudflare } = await import('@cloudflare/vite-plugin');

  return {
    css: { postcss: { plugins: [tailwindcss()] } },
    server: {
      ...(isCodexSeatbeltSandbox ? { watch: { useFsEvents: false, usePolling: true } } : {}),
      proxy: {
        '^/__restblu/firebase/identity/accounts:(signInWithPassword|signUp|sendOobCode|delete|update|lookup)(?:\\?|$)': {
          target: 'https://identitytoolkit.googleapis.com',
          changeOrigin: true,
          secure: true,
          proxyTimeout: 15_000,
          rewrite: (path) => path.replace('/__restblu/firebase/identity/', '/v1/'),
          configure: (proxy) => proxy.on('proxyReq', (request) => {
            request.removeHeader('cookie');
            request.removeHeader('authorization');
          }),
        },
        '^/__restblu/firebase/token(?:\\?|$)': {
          target: 'https://securetoken.googleapis.com',
          changeOrigin: true,
          secure: true,
          proxyTimeout: 15_000,
          rewrite: (path) => path.replace('/__restblu/firebase/token', '/v1/token'),
          configure: (proxy) => proxy.on('proxyReq', (request) => {
            request.removeHeader('cookie');
            request.removeHeader('authorization');
          }),
        },
      } satisfies Record<string, ProxyOptions>,
    },
    plugins: [
      vinext(),
      sites(),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        config: localBindingConfig,
      }),
    ],
  };
});
