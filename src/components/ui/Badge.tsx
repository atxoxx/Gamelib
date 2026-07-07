import type { HTMLAttributes, ReactNode } from "react";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "info" | "accent";
type BadgeSize = "sm" | "md";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  /** Optional leading dot indicator (e.g., for status badges). */
  dot?: boolean;
  children?: ReactNode;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "ui-badge--default",
  success: "ui-badge--success",
  warning: "ui-badge--warning",
  danger: "ui-badge--danger",
  info: "ui-badge--info",
  accent: "ui-badge--accent",
};

export function Badge({
  variant = "default",
  size = "sm",
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={[
        "ui-badge",
        variantClasses[variant],
        size === "md" ? "ui-badge--md" : "",
        dot ? "ui-badge--dot" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {dot && <span className="ui-badge__dot" aria-hidden />}
      {children}
    </span>
  );
}
