"use client";

import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";
import { useState } from "react";
import { ApiError } from "@/lib/api";
import { describeError } from "@/lib/error-message";
import { SESSION_LOCKED_CODE } from "@/lib/unlock-path";
import { activeI18n } from "@/lib/i18n/active";
import { toast } from "@/lib/toast";

/**
 * Failures that already have somewhere to go: the lock screen takes over the
 * page, and a step-up prompt is the UI asking for more, not an error.
 */
function isHandledElsewhere(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.code === SESSION_LOCKED_CODE || error.code === "step_up_required")
  );
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        /**
         * Every write in the app funnels through here, so a failure can no
         * longer end as a `console.error` nobody sees. Call sites that show
         * the failure in place — a form that marks its own field — opt out
         * with `meta: { quiet: true }`.
         */
        mutationCache: new MutationCache({
          onError: (error, _vars, _ctx, mutation) => {
            if (mutation.meta?.quiet || isHandledElsewhere(error)) return;
            // Read at failure time, not at construction time: the cache
            // outlives any one render and the locale can change under it.
            const { t } = activeI18n();
            const { title, description } = describeError(error, t);
            toast.error(title, {
              description,
              // A dead session is the one failure the user can't retry their
              // way out of — the toast carries the way back instead.
              action:
                error instanceof ApiError && error.status === 401
                  ? { label: t("auth.signIn"), onClick: () => window.location.reload() }
                  : undefined,
              // Repeated failures of the same action replace each other
              // instead of stacking up.
              key: mutation.options.mutationKey?.join("/") ?? title,
            });
          },
        }),
        defaultOptions: {
          queries: {
            staleTime: 30 * 1000,
            retry: 1,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
