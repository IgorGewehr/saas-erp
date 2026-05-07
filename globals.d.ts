// Tipo declarations pra side-effect imports de CSS de pacotes node_modules.
// Necessário pra `import '@univerjs/preset-sheets-core/lib/index.css'` que
// o bundler do Next.js resolve mas o TS sem isso reclama.
declare module '*.css';
