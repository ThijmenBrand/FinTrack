import { redirect } from "next/navigation";

// Accounts graduated out of Settings into its own top-level page. Kept so old
// links and bookmarks still land somewhere.
export default function SettingsAccountsRedirect() {
  redirect("/accounts");
}
