"use client";
// Client sidecar for step 2 — the country picker. Uncontrolled by default
// (server action reads the form on submit); we just keep a local state
// so the "you selected X" preview line updates as the operator picks.

import { useState } from "react";
import { inputCls } from "@/components/OnboardShell";
import { countryProfile } from "@/lib/countries";

export default function Step2CountrySelect({
  defaultValue,
  options,
}: {
  defaultValue: string;
  options: Array<{ value: string; label: string }>;
}) {
  const [value, setValue] = useState(defaultValue);
  const cp = countryProfile(value);

  return (
    <div>
      <select
        name="country_code"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className={inputCls}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <p className="mt-1 font-mono text-[10px] uppercase tracking-wide text-clay">
        VAT {cp.vat.standard}% · Food {cp.vat.reduced_food}% · {cp.timezone} · {cp.currency_code}
      </p>
    </div>
  );
}
