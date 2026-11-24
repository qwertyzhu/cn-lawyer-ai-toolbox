/**
 * Centralized White-Label & Auth Mode Configuration (CN Lawyer AI Toolbox OSS)
 *
 * Customize via `.env` / Vite env vars (`VITE_*`) without editing source files:
 * - Default `VITE_AUTH_MODE=open`: personal lawyers use everything immediately with zero login gate.
 * - Optional `VITE_AUTH_MODE=license`: law firms run `npm run init-keys` to enable ECDSA P-256
 *   real-name activation codes & Director account enable/disable console.
 */

const env = (typeof import.meta !== 'undefined' && (import.meta as unknown as { env?: Record<string, string | undefined> }).env) || {};

export type ToolboxAuthMode = 'open' | 'license';

export const SITE_CONFIG = {
  appName: env.VITE_APP_NAME?.trim() || '中国律师 AI 工具箱',
  shortName: env.VITE_APP_SHORT_NAME?.trim() || '律师AI工具箱',
  firmName: env.VITE_FIRM_NAME?.trim() || '',
  heroTitle: env.VITE_HERO_TITLE?.trim() || '中国律师 AI 工具箱 · 随身办案单兵舱',
  subtitle: env.VITE_SUBTITLE?.trim() || '离线优先 PWA · 开源法律工作台',
  authMode: (env.VITE_AUTH_MODE === 'license' ? 'license' : 'open') as ToolboxAuthMode,
  oaUrl: env.VITE_OA_URL?.trim() || '',
  oaLabel: env.VITE_OA_LABEL?.trim() || '律所 OA 系统',
  /**
   * Default public IMA Legal & Case Library maintained by the project author
   * (44,800+ SPC Case Library precedents, 2026 statutes & judicial interpretations).
   * Override via `VITE_IMA_SHARE_URL` to point to your own law firm's IMA library.
   */
  publicImaShareUrl:
    env.VITE_IMA_SHARE_URL?.trim() ||
    'https://ima.qq.com/wiki/?shareId=a5d4993fac94797dc3892f0157c5a4011efd105c495d2b0e45ac311dc7dda91b',
  publicImaLibraryName: env.VITE_IMA_KB_NAME?.trim() || '法律法规案例库（持续更新）',
  githubUrl: 'https://github.com/qwertyzhu/cn-lawyer-ai-toolbox',
};
