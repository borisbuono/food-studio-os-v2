// Guest-booking helpers shared between the /api/guest/book route and the
// preferences page (which also needs to look up bookings).

export type SlotWindow = { start: string; end: string };
const DEFAULT_HOURS: SlotWindow[] = [
  { start: "13:00", end: "15:30" },   // lunch
  { start: "19:00", end: "22:30" },   // dinner
];

export function buildTimeSlots(hours?: SlotWindow[]): string[] {
  const H = hours && hours.length ? hours : DEFAULT_HOURS;
  const slots: string[] = [];
  for (const w of H) {
    const [sH, sM] = w.start.split(":").map(Number);
    const [eH, eM] = w.end.split(":").map(Number);
    let mins = sH * 60 + sM;
    const end = eH * 60 + eM;
    while (mins <= end) {
      slots.push(`${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`);
      mins += 30;
    }
  }
  return slots;
}

export function validEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s || "");
}
export function sanitizePhone(s: string): string {
  return (s || "").replace(/[^\d+ ]/g, "").trim();
}

export const OCCASIONS = [
  { key: "birthday",    label: "Birthday" },
  { key: "anniversary", label: "Anniversary" },
  { key: "business",    label: "Business" },
  { key: "no_occasion", label: "Just visiting" },
] as const;
