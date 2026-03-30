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
};

module.exports = nextConfig;
