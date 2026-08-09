import { FinancialMonthSettingsCard } from "@/components/financial-month-settings-card";
import { LanguageSettingsCard } from "@/components/language-settings-card";
import { SimpleModeSettingsCard } from "@/components/simple-mode-settings-card";
import { StatResetSettingsCard } from "@/components/stat-reset-settings-card";
import { TransactionSettingsCard } from "@/components/transaction-settings-card";

export default function GeneralSettingsPage() {
  return (
    <div className="space-y-6">
      <SimpleModeSettingsCard />
      <LanguageSettingsCard />
      <FinancialMonthSettingsCard />
      <StatResetSettingsCard />
      <TransactionSettingsCard />
    </div>
  );
}
