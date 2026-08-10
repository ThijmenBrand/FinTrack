import { SettingsHeader } from "@/components/settings/settings-ui";
import { InterfaceSection } from "@/components/settings/interface-section";
import { FinancialMonthSection } from "@/components/settings/financial-month-section";
import { TransactionSection } from "@/components/settings/transaction-section";
import { StatResetSection } from "@/components/settings/stat-reset-section";

export default function GeneralSettingsPage() {
  return (
    // Ordered by how often you touch it and how much it moves: presentation
    // first, then the period every number is grouped into, then list defaults,
    // and resets last — the one that changes what your averages mean.
    // Bounded: a settings row is label-left/control-right, and on a wide monitor
    // an unbounded row puts metres of nothing between the two.
    <div className="max-w-3xl space-y-6">
      <SettingsHeader
        title="settings.general.title"
        description="settings.general.description"
      />
      <InterfaceSection />
      <FinancialMonthSection />
      <TransactionSection />
      <StatResetSection />
    </div>
  );
}
