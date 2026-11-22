import "@tanstack/react-query";

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: {
      /**
       * Suppress the app-wide failure toast for this mutation. Set it only
       * when the UI already shows the failure where the user is looking —
       * an inline field error, a row that stays armed. Everything else
       * should let the toast speak.
       */
      quiet?: boolean;
    };
  }
}
