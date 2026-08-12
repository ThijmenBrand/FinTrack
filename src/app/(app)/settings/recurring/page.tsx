import { redirect } from "next/navigation";

// Recurring moved out of Settings — it's budget data, not setup. Kept so old
// bookmarks and links land on the page instead of a 404.
export default function RecurringSettingsRedirect() {
  redirect("/recurring");
}
