"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { apiFetch, ApiError } from "@/lib/api";
import { useI18n } from "@/lib/i18n/client";
import { toIsoDate } from "@/lib/utils";
import type { MessageKey } from "@/lib/i18n/translate";

/**
 * Record a trade, or price something already held.
 *
 * Two jobs in one dialog because they are the same habit: you open your broker,
 * and either something happened or nothing did but the numbers moved. Splitting
 * them into two buttons would put the rarer one (a trade) in front of the
 * commoner one (a price) every month.
 *
 * The form shows only the fields the chosen kind of row actually needs — a fee
 * has no quantity, a dividend has no unit price — rather than greying four
 * boxes someone has to read past.
 */

const ASSET_CLASSES = [
  "equity",
  "bond",
  "cash",
  "commodity",
  "real_estate",
  "crypto",
  "other",
] as const;

const CLASS_LABELS: Record<string, MessageKey> = {
  equity: "investments.class.equity",
  bond: "investments.class.bond",
  cash: "investments.class.cash",
  commodity: "investments.class.commodity",
  real_estate: "investments.class.realEstate",
  crypto: "investments.class.crypto",
  other: "investments.class.other",
};

type Mode = "trade" | "price";
type TradeType = "buy" | "sell" | "dividend" | "fee";

const NEW = "__new__";

interface AccountOption {
  id: string;
  name: string;
}

interface InstrumentOption {
  id: string;
  name: string;
  accountId: string;
}

export function AddTradeDialog({
  accounts,
  instruments,
}: {
  accounts: AccountOption[];
  instruments: InstrumentOption[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const today = toIsoDate(new Date());

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("trade");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [type, setType] = useState<TradeType>("buy");
  const [instrumentId, setInstrumentId] = useState<string>(NEW);
  const [name, setName] = useState("");
  const [isin, setIsin] = useState("");
  const [assetClass, setAssetClass] = useState("equity");
  const [date, setDate] = useState(today);
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [fee, setFee] = useState("");
  const [price, setPrice] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);

  const forAccount = instruments.filter((i) => i.accountId === accountId);
  const isNew = instrumentId === NEW;
  const needsQuantity = type === "buy" || type === "sell";
  const needsUnitPrice = type !== "fee";

  function reset() {
    setType("buy");
    setInstrumentId(forAccount.length > 0 ? forAccount[0].id : NEW);
    setName("");
    setIsin("");
    setAssetClass("equity");
    setDate(today);
    setQuantity("");
    setUnitPrice("");
    setFee("");
    setPrice("");
    setError(null);
  }

  function openDialog() {
    reset();
    setOpen(true);
  }

  const num = (v: string) => (v === "" ? 0 : parseFloat(v));

  async function save() {
    setSaving(true);
    setError(null);
    try {
      if (mode === "price") {
        await apiFetch(`/api/accounts/${accountId}/holdings`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ instrumentId, date, price: num(price) }),
        });
      } else {
        await apiFetch(`/api/accounts/${accountId}/holdings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(isNew
              ? { instrument: { name, isin: isin || null, assetClass } }
              : { instrumentId }),
            type,
            date,
            quantity: num(quantity),
            unitPrice: num(unitPrice),
            fee: num(fee),
          }),
        });
      }
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(
        e instanceof ApiError && e.code
          ? (e.code as MessageKey)
          : "investments.trade.failed",
      );
    } finally {
      setSaving(false);
    }
  }

  if (accounts.length === 0) return null;

  const canSave =
    mode === "price"
      ? !isNew && price !== ""
      : (isNew ? name !== "" : true) &&
        (!needsQuantity || quantity !== "") &&
        (type !== "fee" || fee !== "") &&
        (type !== "dividend" || unitPrice !== "");

  return (
    <>
      <Button variant="outline" onClick={openDialog}>
        <Plus className="h-4 w-4" />
        {t("investments.trade.action")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("investments.trade.title")}</DialogTitle>
            <DialogDescription>
              {mode === "price"
                ? t("investments.trade.priceDescription")
                : t("investments.trade.description")}
            </DialogDescription>
          </DialogHeader>

          <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)}>
            <TabsList className="w-full">
              <TabsTrigger value="trade" className="flex-1">
                {t("investments.trade.modeTrade")}
              </TabsTrigger>
              <TabsTrigger
                value="price"
                className="flex-1"
                disabled={forAccount.length === 0}
              >
                {t("investments.trade.modePrice")}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="space-y-4">
            {accounts.length > 1 && (
              <div className="grid gap-2">
                <Label htmlFor="trade-account">
                  {t("investments.trade.accountLabel")}
                </Label>
                <Select
                  value={accountId}
                  onValueChange={(v) => {
                    setAccountId(v);
                    setInstrumentId(NEW);
                  }}
                >
                  <SelectTrigger id="trade-account">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {mode === "trade" && (
              <div className="grid gap-2">
                <Label htmlFor="trade-type">{t("investments.trade.typeLabel")}</Label>
                <Select value={type} onValueChange={(v) => setType(v as TradeType)}>
                  <SelectTrigger id="trade-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="buy">{t("investments.trade.buy")}</SelectItem>
                    <SelectItem value="sell">{t("investments.trade.sell")}</SelectItem>
                    <SelectItem value="dividend">
                      {t("investments.trade.dividend")}
                    </SelectItem>
                    <SelectItem value="fee">{t("investments.trade.fee")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid gap-2">
              <Label htmlFor="trade-instrument">
                {t("investments.trade.instrumentLabel")}
              </Label>
              <Select value={instrumentId} onValueChange={setInstrumentId}>
                <SelectTrigger id="trade-instrument">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {forAccount.map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
                  {mode === "trade" && (
                    <SelectItem value={NEW}>
                      {t("investments.trade.newInstrument")}
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            {mode === "trade" && isNew && (
              <div className="grid gap-4 rounded-lg border p-3">
                <div className="grid gap-2">
                  <Label htmlFor="trade-name">
                    {t("investments.trade.nameLabel")}
                  </Label>
                  <Input
                    id="trade-name"
                    placeholder={t("investments.trade.namePlaceholder")}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="trade-isin">
                      {t("investments.trade.isinLabel")}
                    </Label>
                    <Input
                      id="trade-isin"
                      placeholder="IE00B4L5Y983"
                      value={isin}
                      onChange={(e) => setIsin(e.target.value)}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="trade-class">
                      {t("investments.trade.classLabel")}
                    </Label>
                    <Select value={assetClass} onValueChange={setAssetClass}>
                      <SelectTrigger id="trade-class">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ASSET_CLASSES.map((c) => (
                          <SelectItem key={c} value={c}>
                            {t(CLASS_LABELS[c])}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="trade-date">{t("investments.trade.dateLabel")}</Label>
                <Input
                  id="trade-date"
                  type="date"
                  max={today}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              {mode === "price" ? (
                <div className="grid gap-2">
                  <Label htmlFor="trade-price">
                    {t("investments.trade.priceLabel")}
                  </Label>
                  <Input
                    id="trade-price"
                    type="number"
                    step="0.0001"
                    min="0"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                  />
                </div>
              ) : needsQuantity ? (
                <div className="grid gap-2">
                  <Label htmlFor="trade-quantity">
                    {t("investments.trade.quantityLabel")}
                  </Label>
                  <Input
                    id="trade-quantity"
                    type="number"
                    step="0.0001"
                    min="0"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </div>
              ) : null}
            </div>

            {mode === "trade" && (
              <div className="grid grid-cols-2 gap-4">
                {needsUnitPrice && (
                  <div className="grid gap-2">
                    <Label htmlFor="trade-unit-price">
                      {type === "dividend"
                        ? t("investments.trade.amountLabel")
                        : t("investments.trade.unitPriceLabel")}
                    </Label>
                    <Input
                      id="trade-unit-price"
                      type="number"
                      step="0.0001"
                      min="0"
                      value={unitPrice}
                      onChange={(e) => setUnitPrice(e.target.value)}
                    />
                  </div>
                )}
                <div className="grid gap-2">
                  <Label htmlFor="trade-fee">{t("investments.trade.feeLabel")}</Label>
                  <Input
                    id="trade-fee"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="0.00"
                    value={fee}
                    onChange={(e) => setFee(e.target.value)}
                  />
                </div>
              </div>
            )}

            {error && (
              <p className="text-xs text-red-600 dark:text-red-400">{t(error)}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button onClick={save} disabled={saving || !canSave}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? t("common.saving") : t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
