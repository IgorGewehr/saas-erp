/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  serverExternalPackages: [
    '@whiskeysockets/baileys',
    'pino',
    'ws',
    'qrcode',
    'bufferutil',
    'utf-8-validate',
    'fluent-ffmpeg',
    '@ffmpeg-installer/ffmpeg',
    'firebase-admin',
    '@google-cloud/firestore',
    '@google-cloud/storage',
    'google-gax',
    'protobufjs',
    '@grpc/grpc-js',
    '@grpc/proto-loader',
    'sharp',
    'google-auth-library',
    'gaxios',
    'node-fetch',
    'fetch-blob',
    'node-domexception',
  ],
  experimental: {
    serverActions: {
      bodySizeLimit: '10mb',
    },
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '**' },
    ],
  },
  webpack: (config, { isServer }) => {
    if (isServer) {
      // serverExternalPackages do Next 15 não cobre o bundling do instrumentation hook,
      // que arrasta firebase-admin + cadeia transitiva. Externalizamos via webpack
      // externals pra cobrir todos os bundles server-side.
      //
      // Prefixos com '/' (ex: '@google-cloud/') casam todo o escopo.
      // Sem '/' são pacotes específicos (também casam subpaths via 'pkg/...').
      const externalPrefixes = [
        // Firebase & Google Cloud
        'firebase-admin',
        '@firebase/',
        '@google-cloud/',
        '@grpc/',
        'google-auth-library',
        'google-gax',
        'gaxios',
        'gtoken',
        'gcp-metadata',
        'protobufjs',
        'long',
        // node-fetch chain (fetch-blob → node-domexception, etc.)
        'node-fetch',
        'fetch-blob',
        'node-domexception',
        'formdata-polyfill',
        'web-streams-polyfill',
        // Baileys / WhatsApp
        '@whiskeysockets/',
        'libsignal',
        'node-cache',
        '@hapi/',
        // Image / media
        'sharp',
        'fluent-ffmpeg',
        '@ffmpeg-installer/',
        'qrcode',
        // Logging
        'pino',
        'pino-pretty',
        // WebSocket / native
        'ws',
        'bufferutil',
        'utf-8-validate',
        // JWT
        'jsonwebtoken',
        'jwks-rsa',
        'jws',
        'jwa',
      ];

      const isExternal = (request) => {
        for (const prefix of externalPrefixes) {
          if (prefix.endsWith('/')) {
            // escopo ou diretório — qualquer coisa começando com o prefixo
            if (request.startsWith(prefix)) return true;
          } else {
            // pacote exato ou subpath
            if (request === prefix || request.startsWith(prefix + '/')) return true;
          }
        }
        return false;
      };

      config.externals = config.externals || [];
      config.externals.push(({ request }, callback) => {
        if (!request) return callback();
        // Esquema "node:" — built-ins do Node. Webpack do Next 15 não trata
        // nativamente em todos os targets; externalizar pra Node resolver em runtime.
        if (request.startsWith('node:')) {
          return callback(null, 'commonjs ' + request);
        }
        if (isExternal(request)) {
          return callback(null, 'commonjs ' + request);
        }
        callback();
      });

      // Optional deps que pacotes carregam via try/catch em runtime mas o webpack
      // tenta resolver estaticamente — gera "Module not found" inofensivo.
      config.ignoreWarnings = [
        ...(config.ignoreWarnings || []),
        { module: /node_modules[\\/]@whiskeysockets[\\/]baileys/ },
        { module: /node_modules[\\/]libsignal/ },
        { module: /node_modules[\\/]sharp/ },
        { module: /node_modules[\\/]node-domexception/ },
        { module: /node_modules[\\/]fetch-blob/ },
        { message: /Critical dependency: the request of a dependency is an expression/ },
      ];
    }
    return config;
  },
};

module.exports = nextConfig;
