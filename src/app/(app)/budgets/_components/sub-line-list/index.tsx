"use client";

import type { Allocation } from "@/types/api";
import { Container } from "./container";
import type { Ctx } from "./constants";

interface SubLineListProps {
  alloc: Allocation;
  /** Container cap in stored (monthly) units = alloc.amount. */
  cap: number;
  toDisplay: (stored: number) => number;
  toStored: (shown: number) => number;
  readOnly?: boolean;
  /** "dialog" drops the <li> chrome so the list works inside the edit dialog. */
  variant?: "list" | "dialog";
}

/**
 * An allocation's planning split as quiet rows under it: name + amount only,
 * no spend tracking. Amounts live in stored (monthly) units; toDisplay/toStored
 * convert at the edges so yearly plans can talk in annual figures.
 */
export function SubLineList({
  alloc,
  cap,
  toDisplay,
  toStored,
  readOnly = false,
  variant = "list",
}: SubLineListProps) {
  const ctx: Ctx = {
    allocationId: alloc.id,
    color: alloc.categoryColor,
    toDisplay,
    toStored,
    readOnly,
    variant,
  };
  return (
    <Container ctx={ctx} lines={alloc.subLines} cap={cap} parentId={null} depth={1} />
  );
}
