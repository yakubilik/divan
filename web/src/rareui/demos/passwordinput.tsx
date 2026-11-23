"use client";

import PasswordInput from "@/components/ui/password-input";

export default function PasswordInputPage() {
  return (
    <div className="relative flex h-full items-center justify-center px-6">
      <PasswordInput
        placeholder="Enter a password"
        autoComplete="new-password"
      />
    </div>
  );
}
