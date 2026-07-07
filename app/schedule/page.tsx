// Sunset 2027-01-08 — legacy path preserved for bookmarks
import { redirect } from "next/navigation";
export default function ScheduleRedirect() {
  redirect("/administrate/team/schedule");
}
