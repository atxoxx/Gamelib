import type { HTMLAttributes } from "react";

type SkeletonShape = "text" | "circle" | "rect";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** The visual shape of the skeleton placeholder. */
  shape?: SkeletonShape;
  /** Width (CSS value). Defaults to 100% for text/rect, explicit for circle. */
  width?: string;
  /** Height (CSS value). Defaults to 1em for text, matches width for circle. */
  height?: string;
  /** If true, renders as inline-block to sit alongside text. */
  inline?: boolean;
}

const shapeClasses: Record<SkeletonShape, string> = {
  text: "ui-skeleton--text",
  circle: "ui-skeleton--circle",
  rect: "ui-skeleton--rect",
};

export function Skeleton({
  shape = "text",
  width,
  height,
  inline = false,
  className,
  style,
  ...props
}: SkeletonProps) {
  return (
    <div
      className={[
        "ui-skeleton",
        shapeClasses[shape],
        inline ? "ui-skeleton--inline" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        ...style,
        width: width ?? (shape === "text" ? "100%" : undefined),
        height: height ?? (shape === "text" ? "1em" : undefined),
      }}
      aria-hidden="true"
      {...props}
    />
  );
}

/** Convenience: a paragraph of skeleton text lines. */
export interface SkeletonTextProps {
  /** Number of lines. Default 3. */
  lines?: number;
  /** Width of the last line as a percentage (simulates real text). */
  lastLineWidth?: string;
}

export function SkeletonText({
  lines = 3,
  lastLineWidth = "60%",
}: SkeletonTextProps) {
  return (
    <div className="ui-skeleton-text">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          shape="text"
          width={i === lines - 1 ? lastLineWidth : "100%"}
        />
      ))}
    </div>
  );
}
