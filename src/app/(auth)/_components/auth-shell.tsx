"use client";

import { Landmark, ShieldCheck, Sparkles, Users } from "lucide-react";
import { useI18n } from "@/lib/i18n/client";

// Sparkline shape, reused for the stroke and its gradient fill.
const SPARK =
  "M0 72 C 28 62, 46 30, 78 40 S 122 70, 152 50 S 202 14, 238 28 S 292 20, 320 6";

// Shared control styling for every auth form. text-base below sm: iOS Safari
// zooms the page on focus when an input's font-size is under 16px.
export const authInputClass =
  "flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:h-10 sm:text-sm";

export const authButtonClass =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 text-base font-medium text-primary-foreground shadow-lg shadow-primary/25 transition-all hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50";

export const authSecondaryButtonClass =
  "inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl border border-input bg-background px-5 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 sm:w-auto";

export function AuthHeading({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="space-y-2">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        {title}
      </h1>
      {subtitle && <p className="text-muted-foreground">{subtitle}</p>}
    </div>
  );
}

export function AuthShell({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();

  return (
    // min-h-dvh, not min-h-screen: 100vh sits under the mobile URL bar.
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex flex-col px-5 py-8 sm:px-12 sm:py-10 lg:px-16">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Landmark className="h-5 w-5" />
          </div>
          <span className="text-lg font-semibold tracking-tight text-foreground">
            {t("nav.appShortName")}
          </span>
        </div>

        <div className="flex flex-1 items-center py-8 sm:py-14">
          <div className="w-full max-w-md">{children}</div>
        </div>
      </div>

      <AuthHero />
    </div>
  );
}

function AuthHero() {
  const { t } = useI18n();

  const features = [
    { icon: ShieldCheck, label: t("auth.heroFeatureSecure") },
    { icon: Users, label: t("auth.heroFeatureShared") },
    { icon: Sparkles, label: t("auth.heroFeatureInsights") },
  ];

  return (
    // Always dark, whatever the app theme is — the art is lit for a dark panel.
    <div className="relative hidden overflow-hidden bg-[#070d1f] p-12 text-white lg:flex lg:flex-col lg:justify-end">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="auth-drift absolute -left-32 -top-32 h-[36rem] w-[36rem] rounded-full bg-[radial-gradient(circle,rgba(56,132,255,0.55),transparent_65%)] blur-3xl" />
        <div className="auth-drift-alt absolute -right-24 top-1/4 h-[32rem] w-[32rem] rounded-full bg-[radial-gradient(circle,rgba(147,92,255,0.45),transparent_65%)] blur-3xl" />
        <div className="auth-drift absolute -bottom-40 left-1/4 h-[30rem] w-[30rem] rounded-full bg-[radial-gradient(circle,rgba(34,211,238,0.30),transparent_65%)] blur-3xl" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_72%)]" />
      </div>

      <HeroArt />

      <div className="relative">
        <h2 className="max-w-lg text-balance text-4xl font-semibold leading-[1.1] tracking-tight xl:text-5xl">
          {t("auth.heroTitle")}
        </h2>
        <p className="mt-4 max-w-md text-pretty text-base leading-relaxed text-white/65">
          {t("auth.heroSubtitle")}
        </p>
        <ul className="mt-10 flex flex-wrap gap-x-8 gap-y-4">
          {features.map(({ icon: Icon, label }) => (
            <li
              key={label}
              className="flex items-center gap-2.5 text-sm text-white/80"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/10">
                <Icon className="h-4 w-4" />
              </span>
              {label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function HeroArt() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-[6%] flex justify-center xl:top-[10%]"
    >
      <div className="auth-float relative w-[26rem]">
        <div className="rounded-3xl border border-white/15 bg-white/[0.07] p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)] backdrop-blur-xl">
          <div className="flex items-baseline justify-between">
            <span className="h-2 w-20 rounded-full bg-white/25" />
            <span className="rounded-full bg-emerald-400/15 px-2.5 py-1 text-xs font-medium text-emerald-300">
              +12,4%
            </span>
          </div>
          <p className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">
            € 12.480,20
          </p>

          <svg
            viewBox="0 0 320 90"
            className="mt-5 h-24 w-full"
            preserveAspectRatio="none"
          >
            <defs>
              <linearGradient id="auth-spark" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7dd3fc" stopOpacity="0.45" />
                <stop offset="100%" stopColor="#7dd3fc" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={`${SPARK} L320 90 L0 90 Z`} fill="url(#auth-spark)" />
            <path
              d={SPARK}
              fill="none"
              stroke="#7dd3fc"
              strokeWidth="2.5"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>

          <div className="mt-5 flex h-16 items-end gap-2.5">
            {[38, 62, 45, 88, 54, 72, 30].map((h, i) => (
              <span
                key={i}
                style={{ height: `${h}%` }}
                className="flex-1 rounded-md bg-gradient-to-t from-blue-500/25 to-violet-400/80"
              />
            ))}
          </div>
        </div>

        <div className="auth-float-slow absolute -left-16 top-16 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-medium shadow-xl backdrop-blur-xl">
          <span className="text-emerald-300 tabular-nums">+ € 3.200,00</span>
        </div>
        <div className="auth-float absolute -right-12 bottom-10 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-medium shadow-xl backdrop-blur-xl">
          <span className="text-white/85 tabular-nums">− € 42,30</span>
        </div>
      </div>
    </div>
  );
}
