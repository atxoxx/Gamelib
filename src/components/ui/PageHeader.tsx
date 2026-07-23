import type { HTMLAttributes, ReactNode } from "react";

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  /** Small uppercase brand eyebrow rendered above the title. */
  eyebrow?: ReactNode;
  /** The page title (rendered as an <h1>). */
  title: ReactNode;
  /** Optional supporting line under the title. */
  description?: ReactNode;
  /** Optional leading icon shown to the left of the title block. */
  icon?: ReactNode;
  /** Right-aligned action slot (buttons, filters, etc.). */
  actions?: ReactNode;
}

/**
 * PageHeader — the canonical header for every desktop route.
 *
 * Provides a single, consistent treatment: a brand eyebrow + solid
 * title + optional description on the left, and an actions slot on the
 * right, separated by a hairline border. Replaces the many bespoke
 * per-page header classes (`.dl-page-header`, `.storage__page-header`,
 * `.activity__title`, …) so the whole app reads as one product.
 *
 * Theme-safe by design: the title stays solid `--color-text-primary`
 * (gradient text clips poorly on light themes) while the eyebrow
 * supplies the brand color via `.brand-eyebrow`.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  icon,
  actions,
  className,
  ...props
}: PageHeaderProps) {
  return (
    <header
      className={["page-header", "fade-up", className ?? ""].filter(Boolean).join(" ")}
      {...props}
    >
      <div className="page-header__main">
        {eyebrow && <span className="brand-eyebrow page-header__eyebrow">{eyebrow}</span>}
        <h1 className="page-header__title">
          {icon && <span className="page-header__icon" aria-hidden>{icon}</span>}
          {title}
        </h1>
        {description && <p className="page-header__description">{description}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}
