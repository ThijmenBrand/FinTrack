"use client";

interface BarProps {
  value: number;
  maxValue: number;
  color: string;
  label: string;
  amount: string;
  onClick?: () => void;
}

// Simple horizontal bar with a label and amount, optionally clickable.
export function Bar({ value, maxValue, color, label, amount, onClick }: BarProps) {
  const pct = maxValue > 0 ? (value / maxValue) * 100 : 0;
  const clickable = Boolean(onClick);
  return (
    <div
      className={`flex items-center gap-3 rounded-md -mx-2 px-2 py-1 ${clickable ? "cursor-pointer hover:bg-muted/60 transition-colors" : ""}`}
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      <div className="w-28 text-sm truncate text-right" title={label}>
        {label}
      </div>
      <div className="flex-1 h-6 bg-muted rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${Math.max(pct, 1)}%`, backgroundColor: color }}
        />
      </div>
      <div className="w-24 text-sm text-right font-medium">{amount}</div>
    </div>
  );
}
