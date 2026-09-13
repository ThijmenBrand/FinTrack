"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useAccounts, useCreateAccount, useUpdateAccount, useDeleteAccount, useReorderAccounts } from "@/hooks/use-accounts";
import { usePreferences, useUpdatePreferences } from "@/hooks/use-preferences";
import type { Account } from "@/types/api";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Landmark,
  Plus,
  Pencil,
  Trash2,
  MoreVertical,
  GripVertical,
  Loader2,
  LogOut,
  Star,
  StarOff,
  Users,
} from "lucide-react";
import { BANKS, bankHasSeparateFeeColumn } from "@/lib/banks";
import { useI18n } from "@/lib/i18n/client";
import type { MessageKey } from "@/lib/i18n/translate";
import { BankLogo } from "@/components/bank-logo";
import { AvatarStack } from "@/components/user-avatar";
import { AccountBalanceDialog } from "@/components/account-balance-dialog";
import {
  DeleteAccountDialog,
  LeaveAccountDialog,
  ShareAccountDialog,
} from "./_components/account-share-dialogs";
import { useResetOnChange } from "@/hooks/use-reset-on-change";

const ACCOUNT_TYPES: { value: string; labelKey: MessageKey }[] = [
  { value: "checking", labelKey: "accounts.type.checking" },
  { value: "savings", labelKey: "accounts.type.savings" },
  { value: "joint", labelKey: "accounts.type.joint" },
  { value: "credit", labelKey: "accounts.type.credit" },
  { value: "other", labelKey: "accounts.type.other" },
];

/** Tooltip for the shared-with avatar stack: everyone, name or invited email. */
function sharedWithNames(people: Account["sharedWithUsers"]): string {
  return people.map((p) => p.name || p.email).filter(Boolean).join(", ");
}

const typeLabelKey = (type: string): MessageKey =>
  ACCOUNT_TYPES.find((t) => t.value === type)?.labelKey ?? "accounts.type.other";

const ACCOUNT_TYPE_STYLES: Record<string, { badge: string }> = {
  checking: {
    badge:
      "bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  },
  savings: {
    badge:
      "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
  },
  joint: {
    badge:
      "bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-200 dark:border-violet-800",
  },
  credit: {
    badge:
      "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-200 dark:border-amber-800",
  },
  other: {
    badge:
      "bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800",
  },
};

function SortableAccountCard({
  account,
  isDefault,
  onEdit,
  onShareRequest,
  onDeleteRequest,
  onLeaveRequest,
  onToggleDefault,
  onOpen,
}: {
  account: Account;
  isDefault: boolean;
  onEdit: (account: Account) => void;
  onShareRequest: (account: Account) => void;
  onDeleteRequest: (account: Account) => void;
  onLeaveRequest: (account: Account) => void;
  onToggleDefault: (id: string, makeDefault: boolean) => void;
  onOpen: (account: Account) => void;
}) {
  const { t, formatCurrency } = useI18n();
  const isOwner = account.role === "owner";
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: account.id, disabled: !isOwner });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
  };

  const { badge: typeBadge } =
    ACCOUNT_TYPE_STYLES[account.type] || ACCOUNT_TYPE_STYLES.other;
  const netChange = account.transactionTotal;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`group relative rounded-xl border bg-card text-card-foreground shadow-sm transition-[box-shadow,border-color] hover:border-primary/40 hover:shadow-md ${
        isDragging ? "opacity-50 shadow-lg" : ""
      }`}
    >
      {/* Drag handle strip — reordering only applies to accounts you own. */}
      {isOwner && (
        <button
          // Full-height strip so the drag target stays generous, but the icon
          // parks next to the bank logo — centred it landed beside the balance
          // and read as debris on a phone, where it's always visible.
          className="absolute left-0 top-0 bottom-0 w-6 flex items-start justify-center pt-8 rounded-l-xl md:opacity-0 md:group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing touch-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-r-none"
          aria-label={t("accounts.reorderLabel", { name: account.name })}
          {...attributes}
          {...listeners}
        >
          <GripVertical className="h-4 w-4 text-muted-foreground/50" />
        </button>
      )}

      <div
        role="button"
        tabIndex={0}
        aria-label={t("accounts.viewHistoryLabel", { name: account.name })}
        onClick={() => onOpen(account)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen(account);
          }
        }}
        className={`p-5 cursor-pointer rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${isOwner ? "pl-6" : ""}`}
      >
        {/* Identity: the name leads, everything that qualifies it sits below in
            one quiet block rather than competing on the name's own line. */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <BankLogo bank={account.bank} size={40} />
            <div className="min-w-0 pt-0.5">
              <h3 className="truncate text-base font-semibold leading-tight">
                {account.name}
              </h3>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {account.bankName || t("accounts.noBank")}
              </p>
              {account.iban && (
                <p className="truncate font-mono text-[11px] text-muted-foreground">
                  {account.iban}
                </p>
              )}
            </div>
          </div>

          {/* Stop the menu from bubbling into the card's open-detail handler. */}
          <div
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md md:opacity-0 md:group-hover:opacity-100 transition-opacity hover:bg-muted focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label={t("accounts.actionsLabel", { name: account.name })}
              >
                <MoreVertical className="h-4 w-4 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {/* Viewers can look but not touch; editors may edit fields but
                  never get Share — inviting is owner-only. */}
              {(isOwner || account.role === "editor") && (
                <DropdownMenuItem onClick={() => onEdit(account)}>
                  <Pencil className="h-4 w-4" />
                  {t("accounts.editAccount")}
                </DropdownMenuItem>
              )}
              {isOwner && (
                <DropdownMenuItem onClick={() => onShareRequest(account)}>
                  <Users className="h-4 w-4" />
                  {t("accounts.shareAccount")}
                </DropdownMenuItem>
              )}
              {isOwner && (
                <DropdownMenuItem onClick={() => onToggleDefault(account.id, !isDefault)}>
                  {isDefault ? (
                    <>
                      <StarOff className="h-4 w-4" />
                      {t("accounts.removeDefault")}
                    </>
                  ) : (
                    <>
                      <Star className="h-4 w-4" />
                      {t("accounts.setDefault")}
                    </>
                  )}
                </DropdownMenuItem>
              )}
              {(isOwner || account.role === "editor") && <DropdownMenuSeparator />}
              {isOwner ? (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDeleteRequest(account)}
                >
                  <Trash2 className="h-4 w-4" />
                  {t("accounts.deleteAccount")}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onLeaveRequest(account)}
                >
                  <LogOut className="h-4 w-4" />
                  {t("accounts.leaveAccount")}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          </div>
        </div>

        {/* Balance — hero element. The movement under it used to be a bare
            signed amount with nothing saying what it measured. */}
        <div className="mt-4">
          <p
            className={`text-2xl font-bold tabular-nums tracking-tight ${
              account.currentBalance >= 0
                ? "text-foreground"
                : "text-red-600 dark:text-red-400"
            }`}
          >
            {formatCurrency(account.currentBalance, account.currency)}
          </p>
          {netChange !== 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              <span
                className={`font-medium tabular-nums ${
                  netChange >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-500 dark:text-red-400"
                }`}
              >
                {netChange >= 0 ? "+" : ""}
                {formatCurrency(netChange, account.currency)}
              </span>{" "}
              {t("accounts.netSinceStart")}
            </p>
          )}
        </div>

        {/* Footer: what kind of account this is, and who else is in it. */}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3">
          <span
            className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${typeBadge}`}
          >
            {t(typeLabelKey(account.type))}
          </span>
          {isDefault && (
            <span
              className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
              title={t("accounts.defaultTooltip")}
            >
              <Star className="h-2.5 w-2.5 fill-current" />
              {t("accounts.default")}
            </span>
          )}
          {/* Two sides of the same fact: shared WITH you (the owner's face plus
              what you're allowed to do) or shared BY you (everyone you
              invited). The names live in the tooltip. */}
          {account.ownerName ? (
            <span className="ml-auto flex items-center gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">
                {t(
                  account.role === "editor"
                    ? "sharing.role.editor"
                    : "sharing.role.viewer",
                )}
              </span>
              <AvatarStack
                className="h-6 w-6 text-[11px]"
                people={[{ name: account.ownerName, image: account.ownerImage }]}
                title={t("sharing.sharedByTooltip", { name: account.ownerName })}
              />
            </span>
          ) : (
            account.sharedWithUsers.length > 0 && (
              <span className="ml-auto flex items-center">
                <AvatarStack
                  className="h-6 w-6 text-[11px]"
                  people={account.sharedWithUsers.map((m) => ({
                    name: m.name || m.email,
                    image: m.image,
                  }))}
                  title={sharedWithNames(account.sharedWithUsers)}
                />
              </span>
            )
          )}
        </div>
      </div>
    </div>
  );
}

const emptyAccounts: Account[] = [];

export default function AccountsPage() {
  return (
    <Suspense>
      <AccountsPageInner />
    </Suspense>
  );
}

function AccountsPageInner() {
  const { t, plural, formatCurrency } = useI18n();
  const searchParams = useSearchParams();
  const { data: accountsData = emptyAccounts, isLoading: loading } = useAccounts();
  const { data: prefs } = usePreferences();
  const updatePrefs = useUpdatePreferences();
  const createAccount = useCreateAccount();
  const updateAccount = useUpdateAccount();
  const deleteAccount = useDeleteAccount();
  const reorderAccounts = useReorderAccounts();
  const queryClient = useQueryClient();

  const [localAccounts, setLocalAccounts] = useState<Account[]>([]);
  // ?new= opens the create dialog straight away (e.g. from the dashboard empty state).
  const [dialogOpen, setDialogOpen] = useState(
    () => searchParams.get("new") !== null
  );
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [detailAccount, setDetailAccount] = useState<Account | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
  const [leaveTarget, setLeaveTarget] = useState<Account | null>(null);
  const [shareTarget, setShareTarget] = useState<Account | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [type, setType] = useState("checking");
  const [bank, setBank] = useState("");
  const [bankName, setBankName] = useState("");
  const [iban, setIban] = useState("");
  const [currency, setCurrency] = useState("EUR");
  const [initialBalance, setInitialBalance] = useState("");
  const [internalTransfers, setInternalTransfers] = useState(true);

  // Server order wins; drag-and-drop overrides it until the next fetch.
  useResetOnChange(accountsData, () => setLocalAccounts(accountsData));

  const resetForm = () => {
    setName("");
    setType("checking");
    setBank("");
    setBankName("");
    setIban("");
    setCurrency("EUR");
    setInitialBalance("");
    setInternalTransfers(true);
    setEditingAccount(null);
  };

  const openEditDialog = (account: Account) => {
    setEditingAccount(account);
    setName(account.name);
    setType(account.type);
    setBank(account.bank || "");
    setBankName(account.bankName || "");
    setIban(account.iban || "");
    setCurrency(account.currency);
    setInitialBalance(String(account.initialBalance));
    setInternalTransfers(account.internalTransfers);
    setDialogOpen(true);
  };

  const handleSubmit = async () => {
    const payload = {
      name,
      type,
      bank: bank || null,
      bankName: bankName || null,
      iban: iban || null,
      currency,
      initialBalance: parseFloat(initialBalance) || 0,
      internalTransfers,
    };

    await (editingAccount
      ? updateAccount.mutateAsync({ id: editingAccount.id, ...payload })
      : createAccount.mutateAsync(payload));

    setDialogOpen(false);
    resetForm();
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    await deleteAccount.mutateAsync(deleteTarget.id);
    setDeleteTarget(null);
  };

  const handleToggleDefault = async (id: string, makeDefault: boolean) => {
    await updatePrefs.mutateAsync({ defaultAccountId: makeDefault ? id : null });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = localAccounts.findIndex((a) => a.id === active.id);
    const newIndex = localAccounts.findIndex((a) => a.id === over.id);
    const newAccounts = arrayMove(localAccounts, oldIndex, newIndex);
    setLocalAccounts(newAccounts);

    try {
      await reorderAccounts.mutateAsync(newAccounts.map((a) => a.id));
    } catch (err) {
      console.error("Failed to reorder accounts:", err);
      // Refetch so the optimistic local order reverts to the server's order.
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
    }
  };

  const saving = createAccount.isPending || updateAccount.isPending;
  const accounts = localAccounts;
  const totalBalance = accounts.reduce((sum, a) => sum + a.currentBalance, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">{t("accounts.title")}</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            {t("accounts.subtitle")}
          </p>
        </div>
        {/* One row on a phone too: the total and the only action share a line
            instead of stacking into a third and fourth header block. */}
        <div className="flex items-center justify-between gap-3 sm:shrink-0 sm:justify-end">
          {/* The total used to be a saturated primary slab below the header —
              the one block on the page that shouted. It's a header stat now. */}
          {accounts.length > 0 && (
            <div className="min-w-0 text-left sm:mr-1 sm:text-right">
              <p className="text-xs text-muted-foreground">
                {t("accounts.totalBalance")}
                {" · "}
                {plural(
                  accounts.length,
                  "accounts.connected.one",
                  "accounts.connected.other",
                )}
              </p>
              <p className="text-lg font-semibold tabular-nums tracking-tight">
                {formatCurrency(totalBalance)}
              </p>
            </div>
          )}
          <Dialog
            open={dialogOpen}
            onOpenChange={(open) => {
              setDialogOpen(open);
              if (!open) resetForm();
            }}
          >
            <DialogTrigger asChild>
              <Button className="shrink-0" data-tour="account-add">
                <Plus className="h-4 w-4" />
                {t("accounts.add")}
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>
                  {editingAccount ? t("accounts.editTitle") : t("accounts.addTitle")}
                </DialogTitle>
                <DialogDescription>
                  {editingAccount
                    ? t("accounts.editDescription")
                    : t("accounts.addDescription")}
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="name">{t("accounts.nameLabel")}</Label>
                  <Input
                    id="name"
                    placeholder={t("accounts.namePlaceholder")}
                    autoComplete="off"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="type">{t("accounts.typeLabel")}</Label>
                  <Select value={type} onValueChange={setType}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACCOUNT_TYPES.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {t(opt.labelKey)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="bank">{t("accounts.bankLabel")}</Label>
                  <Select
                    value={bank || "none"}
                    onValueChange={(v) => setBank(v === "none" ? "" : v)}
                  >
                    <SelectTrigger id="bank">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{t("accounts.bankNotSet")}</SelectItem>
                      {BANKS.map((b) => (
                        <SelectItem key={b.value} value={b.value}>
                          <span className="flex items-center gap-2">
                            <BankLogo bank={b.value} size={24} />
                            {b.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {bank === "other" && (
                    <Input
                      id="bankName"
                      placeholder={t("accounts.bankNamePlaceholder")}
                      autoComplete="off"
                      value={bankName}
                      onChange={(e) => setBankName(e.target.value)}
                    />
                  )}
                  {bankHasSeparateFeeColumn(bank) && (
                    <p className="text-xs text-muted-foreground">
                      {t("accounts.feeColumnHint")}
                    </p>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="iban">{t("accounts.ibanLabel")}</Label>
                  <Input
                    id="iban"
                    placeholder={t("accounts.ibanPlaceholder")}
                    value={iban}
                    onChange={(e) => setIban(e.target.value)}
                  />
                </div>
                <div className="grid gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor="internalTransfers" className="cursor-pointer">
                      {t("accounts.internalTransfersLabel")}
                    </Label>
                    <Switch
                      id="internalTransfers"
                      checked={internalTransfers}
                      onCheckedChange={setInternalTransfers}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("accounts.internalTransfersHint")}
                  </p>
                  {/* Switching it off is retroactive — say so before they save,
                      rather than after: there is no toast layer in this app. */}
                  {editingAccount?.internalTransfers && !internalTransfers && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      {t("accounts.internalTransfersSplitWarning")}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="currency">{t("accounts.currencyLabel")}</Label>
                    <Select value={currency} onValueChange={setCurrency}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="EUR">EUR</SelectItem>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="GBP">GBP</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="balance">{t("accounts.startingBalanceLabel")}</Label>
                    <Input
                      id="balance"
                      type="number"
                      step="0.01"
                      placeholder="0.00"
                      value={initialBalance}
                      onChange={(e) => setInitialBalance(e.target.value)}
                    />
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => {
                    setDialogOpen(false);
                    resetForm();
                  }}
                >
                  {t("common.cancel")}
                </Button>
                <Button onClick={handleSubmit} disabled={!name || saving}>
                  {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                  {saving
                    ? t("common.saving")
                    : editingAccount
                      ? t("accounts.saveChanges")
                      : t("accounts.createAccount")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Account Cards */}
      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border p-5">
              <div className="flex items-start gap-3">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="space-y-1.5 pt-0.5">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
              <Skeleton className="mt-4 h-8 w-32" />
              <Skeleton className="mt-1.5 h-3 w-40" />
              <div className="mt-4 border-t pt-3">
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16">
          <Landmark className="h-12 w-12 text-muted-foreground/30 mb-3" />
          <h3 className="text-base font-medium text-muted-foreground mb-1">
            {t("accounts.emptyTitle")}
          </h3>
          <p className="text-sm text-muted-foreground mb-4">
            {t("accounts.emptyBody")}
          </p>
          <Button onClick={() => setDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t("accounts.add")}
          </Button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
        >
          <SortableContext
            items={accounts.map((a) => a.id)}
            strategy={rectSortingStrategy}
          >
            <div
              className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
              aria-live="polite"
            >
              {accounts.map((account) => (
                <SortableAccountCard
                  key={account.id}
                  account={account}
                  isDefault={prefs?.defaultAccountId === account.id}
                  onEdit={openEditDialog}
                  onShareRequest={setShareTarget}
                  onDeleteRequest={setDeleteTarget}
                  onLeaveRequest={setLeaveTarget}
                  onToggleDefault={handleToggleDefault}
                  onOpen={setDetailAccount}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <AccountBalanceDialog
        account={detailAccount}
        onOpenChange={(open) => !open && setDetailAccount(null)}
      />

      <ShareAccountDialog
        account={shareTarget}
        onOpenChange={(open) => !open && setShareTarget(null)}
      />

      <DeleteAccountDialog
        account={deleteTarget}
        pending={deleteAccount.isPending}
        onConfirm={handleConfirmDelete}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      />

      <LeaveAccountDialog
        account={leaveTarget}
        onOpenChange={(open) => !open && setLeaveTarget(null)}
      />
    </div>
  );
}
