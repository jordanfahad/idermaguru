"use client";

import { useRouter, useSearchParams } from "next/navigation";

type MerchantAnalyticsOption = {
  id: string;
  label: string;
};

export function MerchantAnalyticsSelect({ options }: { options: MerchantAnalyticsOption[] }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const current = searchParams.get("merchant") ?? options[0]?.id ?? "all";

  return (
    <label className="merchant-analytics-select">
      Merchant analytics
      <select
        value={current}
        onChange={(event) => {
          const next = new URLSearchParams(searchParams.toString());
          next.set("merchant", event.target.value);
          router.push(`/admin/analytics?${next.toString()}`);
        }}
      >
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
