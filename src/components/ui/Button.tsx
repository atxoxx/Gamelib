import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  active?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: "ui-btn--primary",
  secondary: "ui-btn--secondary",
  ghost: "ui-btn--ghost",
  danger: "ui-btn--danger",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "ui-btn--sm",
  md: "",
  lg: "ui-btn--lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      isLoading,
      active,
      leftIcon,
      rightIcon,
      className,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        className={[
          "ui-btn",
          variantClasses[variant],
          sizeClasses[size],
          active ? "ui-btn--active" : "",
          className ?? "",
        ]
          .filter(Boolean)
          .join(" ")}
        disabled={isLoading || disabled}
        {...props}
      >
        {isLoading && <span className="ui-btn__spinner" aria-hidden />}
        {!isLoading && leftIcon && (
          <span className="ui-btn__icon ui-btn__icon--left">{leftIcon}</span>
        )}
        <span className="ui-btn__label">{children}</span>
        {!isLoading && rightIcon && (
          <span className="ui-btn__icon ui-btn__icon--right">{rightIcon}</span>
        )}
      </button>
    );
  }
);

Button.displayName = "Button";
