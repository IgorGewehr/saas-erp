/**
 * assinaturas-overview.ts — re-export de conveniência. A implementação mora
 * em `read-models/assinaturas/` (dividida em `types` · `date-utils` ·
 * `membership-axis` · `project-axis` · `index` — cap de 400 linhas/arquivo,
 * ver CLAUDE.md §"Arquitetura de componentes"). Mantém o import path antigo
 * estável pros consumidores (`consultor-rules.ts`, `AssinaturasLens.tsx`,
 * `RecorrentesTab.tsx`).
 */

export * from './assinaturas/index';
