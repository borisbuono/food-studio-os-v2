// Global keyboard shortcut registry.
//
// Two categories:
//   • hard-coded system shortcuts (⌘K, gh/gf, etc.) — installed globally in
//     KeyboardShortcuts.tsx.
//   • local shortcuts (j/k list nav, ⌘Enter submit) — pages opt in via
//     useListNav() / <SubmitOnCmdEnter />.
//
// Two-key g-sequences (g h, g f, …) are handled with a 900 ms grace window
// so we don't fight with normal typing. The listener is inert while the
// user is typing into an input, textarea, contenteditable or select.

export type ShortcutTarget = { href: string; label: string };

export const GO_TARGETS: Record<string, ShortcutTarget> = {
  h: { href: "/",                          label: "Home" },
  f: { href: "/administrate/finance",      label: "Finance" },
  m: { href: "/develop/menu",              label: "Menu" },
  r: { href: "/develop/recipes",           label: "Recipes" },
  t: { href: "/administrate/team",         label: "Team" },
  o: { href: "/office",                    label: "Office" },
  b: { href: "/boh",                       label: "BOH" },
  s: { href: "/administrate/settings",     label: "Settings" },
  c: { href: "/command",                   label: "Command center" },
  i: { href: "/files/inbox",               label: "Files inbox" },
};

// Should shortcuts fire? False when the operator is typing into a form,
// or when a modal/dialog has focus that should trap keys itself.
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!el) return false;
  const n = el as HTMLElement;
  const tag = (n.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (n.isContentEditable) return true;
  return false;
}

// Kbd chips (rendered next to buttons on lg+). Keep as small primitives so
// pages can compose them without another dep.
export const KBD_HINT = {
  submit: "⌘⏎",
  cancel: "esc",
  search: "/",
  next:   "→",
  prev:   "←",
  down:   "j",
  up:     "k",
} as const;
