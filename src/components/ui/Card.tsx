import type { HTMLAttributes, ReactNode } from "react";

type CardVariant = "surface" | "glass" | "raised";
type CardElevation = "none" | "1" | "2" | "3" | "glow";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Visual surface style. */
  variant?: CardVariant;
  /** Shadow elevation level. */
  elevation?: CardElevation;
  /** Apply hover-lift animation. */
  hoverLift?: boolean;
  /** Optional header rendered inside a padded top section. */
  header?: ReactNode;
}

const variantClasses: Record<CardVariant, string> = {
  surface: "ui-card--surface",
  glass: "ui-card--glass glass",
  raised: "ui-card--raised glass-raised",
};

const elevationClasses: Record<CardElevation, string> = {
  none: "",
  "1": "elevation-1",
  "2": "elevation-2",
  "3": "elevation-3",
  glow: "elevation-glow",
};

export function Card({
  variant = "surface",
  elevation = "none",
  hoverLift = false,
  header,
  className,
  children,
  ...props
}: CardProps) {
  return (
    <div
      className={[
        "ui-card",
        variantClasses[variant],
        elevationClasses[elevation],
        hoverLift ? "hover-lift" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      {...props}
    >
      {header && <div className="ui-card__header">{header}</div>}
      <div className="ui-card__body">{children}</div>
    </div>
  );
}
