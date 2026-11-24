import React from 'react';
import { SITE_CONFIG } from '../config/siteConfig';

interface BrandLogoProps {
  variant?: 'light-bg' | 'dark-bg';
  compact?: boolean;
  subtitle?: string;
}

export const BrandLogo: React.FC<BrandLogoProps> = ({
  variant = 'light-bg',
  compact = false,
  subtitle = SITE_CONFIG.appName,
}) => {
  const isDarkBg = variant === 'dark-bg';

  return (
    <div className="inline-flex min-w-0 items-center gap-2.5 select-none">
      <div
        className={`relative flex-none overflow-hidden rounded-[6px] bg-[#0E223D] ${
          compact ? 'h-8 w-8' : 'h-9 w-9 sm:h-10 sm:w-10'
        } ${
          isDarkBg
            ? 'ring-1 ring-[#D1B27A]/45'
            : 'ring-1 ring-[#14181F]/12 shadow-[0_1px_4px_rgba(17,21,28,0.12)]'
        }`}
      >
        <img
          src="/brand-emblem.svg"
          alt={SITE_CONFIG.appName}
          className="h-full w-full object-cover"
        />
      </div>
      <div className="min-w-0">
        <div
          className={`font-display truncate text-[15px] sm:text-[16.5px] font-bold leading-tight tracking-[0.04em] ${
            isDarkBg ? 'text-white' : 'text-[#11151C]'
          }`}
        >
          {subtitle}
        </div>
        {!compact && (
          <div
            className={`mt-0.5 truncate text-[10px] font-medium tracking-[0.12em] ${
              isDarkBg ? 'text-[#D1B27A]/85' : 'text-slate-500'
            }`}
          >
            {SITE_CONFIG.firmName ? `${SITE_CONFIG.firmName} · 内部工作台` : SITE_CONFIG.subtitle}
          </div>
        )}
      </div>
    </div>
  );
};
