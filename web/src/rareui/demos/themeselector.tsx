"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import ThemeSelector from "@/components/ui/theme-selector";

const subscribe = () => () => {};

export default function ThemeSelectorPage() {
  const { resolvedTheme, setTheme } = useTheme();
  // false during ssr and hydration, so the first client render matches the server
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );

  return (
    <div className="relative flex h-full items-center justify-center px-6 font-runde">
      <div className="flex min-w-0 flex-col gap-4 rounded-[22px] bg-white px-5 py-4 dark:bg-black">
        <div className="flex flex-col gap-0.5">
          <p className="text-base font-semibold tracking-[-0.01em] text-black dark:text-white">
            Theme
          </p>
          <p className="text-[13px] font-medium text-[#868593]">
            Pick how the interface looks.
          </p>
        </div>
        <ThemeSelector
          value={hydrated ? (resolvedTheme ?? null) : null}
          onChange={setTheme}
        />
      </div>
    </div>
  );
}
