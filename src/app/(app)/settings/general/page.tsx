import { FinancialMonthSettingsCard } from "@/components/financial-month-settings-card";
import { TransactionSettingsCard } from "@/components/transaction-settings-card";

export default function GeneralSettingsPage() {
  return (
    <div className="space-y-6">
      <FinancialMonthSettingsCard />
      <TransactionSettingsCard />
    </div>
  );
}
