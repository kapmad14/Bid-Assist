import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-blue-600 text-white shadow hover:bg-blue-700",
        secondary:
          "border-transparent bg-gray-100 text-gray-900 hover:bg-gray-200",
        destructive:
          "border-transparent bg-red-600 text-white shadow hover:bg-red-700",
        outline: "text-gray-950 border-gray-300",
        success:
          "border-transparent bg-green-600 text-white shadow hover:bg-green-700",
        warning:
          "border-transparent bg-orange-500 text-white shadow hover:bg-orange-600",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  const combinedClassName = className 
    ? `${badgeVariants({ variant })} ${className}`.trim()
    : badgeVariants({ variant });
  
  return (
    <div className={combinedClassName} {...props} />
  )
}

export { Badge, badgeVariants }
