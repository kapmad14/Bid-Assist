// components/Button.tsx
import React from "react";
import clsx from "clsx";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "success";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  className?: string;
}

const base =
  "inline-flex items-center justify-center rounded-lg font-medium transition-shadow focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-60 disabled:cursor-not-allowed";

const variants: Record<Variant, string> = {
  primary:
    "px-4 py-2 shadow-sm bg-yellow-500 text-white hover:bg-yellow-600 focus:ring-yellow-400",
  secondary:
    "px-3 py-2 border border-gray-300 bg-white text-gray-900 hover:bg-gray-50 focus:ring-gray-300",
  danger:
    "px-3 py-2 bg-red-500 text-white hover:bg-red-600 focus:ring-red-400",
  ghost:
    "px-3 py-2 bg-transparent text-gray-900 hover:bg-gray-50 focus:ring-gray-200",
  success:
    "px-3 py-2 bg-green-500 text-white hover:bg-green-600 focus:ring-green-400",
};

export default function Button({
  variant = "secondary",
  className,
  children,
  ...props
}: Props) {
  return (
    <button
      className={clsx(base, variants[variant], className)}
      {...props}
    >
      {children}
    </button>
  );
}
