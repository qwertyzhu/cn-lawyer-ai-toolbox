import React from 'react';
import {
  BadgeDollarSign,
  BellRing,
  Briefcase,
  Calculator,
  CalendarDays,
  Coins,
  Compass,
  FileSpreadsheet,
  HardHat,
  Layers,
  NotebookPen,
  Percent,
  ShieldAlert,
  ShieldCheck,
  Wrench,
} from 'lucide-react';

const ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  Compass,
  FileSpreadsheet,
  ShieldCheck,
  Calculator,
  BadgeDollarSign,
  Percent,
  Coins,
  CalendarDays,
  BellRing,
  Briefcase,
  HardHat,
  ShieldAlert,
  Layers,
  NotebookPen,
};

export const ToolIcon: React.FC<{ name: string; className?: string }> = ({
  name,
  className = 'h-5 w-5',
}) => {
  const IconComp = ICON_MAP[name] || Wrench;
  return <IconComp className={className} />;
};
