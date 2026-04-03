"use client";

import { useEffect, useRef } from "react";

/**
 * Client component that calls the DB init endpoint once on first mount.
 * Ensures tables and default categories exist.
 */
export function DbInitializer() {
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    fetch("/api/init")
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          console.log("Database initialized successfully");
        } else {
          console.error("Database initialization failed:", data.error);
        }
      })
      .catch((err) => console.error("Failed to reach init endpoint:", err));
  }, []);

  return null;
}
