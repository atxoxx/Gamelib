import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui";

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional fallback label for the breadcrumb. Defaults to "this page". */
  label?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
  componentStack: string | null;
}

/**
 * ErrorBoundary — top-level React error boundary that wraps a single page subtree.
 *
 * Why this exists
 * ───────────────
 * The App component tree renders an entire shell (TopNav + Sidebar) around
 * every page via the AppLayout route nesting. Without an error boundary
 * anywhere in the tree, any uncaught render error inside a page (e.g. a
 * malformed IGDB payload, a corrupted store cache, a missing field on
 * a `StoreGameSummary`) unmounts the entire React tree — leaving a
 * blank window even though the topnav/sidebar themselves are healthy.
 *
 * By slotting this boundary around the `<Outlet />` in `MainContent`,
 * a page-level crash now keeps the topnav + sidebar rendering and
 * surfaces a friendly error UI in the page area with the failing
 * component's name visible for triage.
 *
 * What it catches
 * ───────────────
 *  - Render-phase throws in any descendant component
 *  - Component lifecycle method throws (cDM, cDU)
 *  - Errors thrown from portal children during render
 *
 * What it does NOT catch
 * ──────────────────────
 *  - Event-handler errors (React 18 still surfaces those to window error)
 *  - Async errors (use try/catch in your async helpers)
 *  - Errors thrown in the boundary itself
 *
 * The boundary is intentionally a class component — `getDerivedStateFromError`
 * has no hook equivalent in Stable React.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null, componentStack: null };

  static getDerivedStateFromError(
    error: Error
  ): Pick<ErrorBoundaryState, "error"> {
    // Only `error` is set here — `componentStack` is populated
    // asynchronously in `componentDidCatch` so we have the richer
    // ErrorInfo payload React provides for it.
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ componentStack: info.componentStack ?? null });
    // Always log to the dev console so a developer investigating the
    // "whole app blank" symptom can see the actual stack trace even
    // when the friendly UI is showing instead.
    // eslint-disable-next-line no-console
    console.error("[ErrorBoundary] Render error caught:", error);
    if (info.componentStack) {
      // eslint-disable-next-line no-console
      console.error("[ErrorBoundary] Component stack:", info.componentStack);
    }
  }

  private handleRetry = (): void => {
    this.setState({ error: null, componentStack: null });
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  override render(): ReactNode {
    const { error, componentStack } = this.state;
    const { children, label = "this page" } = this.props;

    if (!error) {
      return children;
    }

    // Pull the top failing component name out of the stack so the user
    // has one actionable line to share when reporting the issue.
    const failingComponent = extractFirstComponent(componentStack);

    return (
      <div className="page-error" role="alert">
        <div className="page-error-card">
          <div className="page-error-icon" aria-hidden="true">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </div>

          <h2 className="page-error-title">
            Something went wrong loading {label}
          </h2>

          <p className="page-error-message">{error.message}</p>

          {failingComponent && (
            <p className="page-error-component">
              <span className="page-error-component-label">Failing component:</span>{" "}
              <code>{failingComponent}</code>
            </p>
          )}

          <div className="page-error-actions">
            <Button variant="primary" size="md" onClick={this.handleRetry}>
              Try Again
            </Button>
            <Button variant="ghost" size="md" onClick={this.handleReload}>
              Reload App
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

/**
 * Pull the name of the FIRST failing component out of the bundle-style
 * component stack string. Format is typically:
 *   "   at Foo (file.tsx:42:11)
 *    at Bar (file.tsx:17:8)
 *    at …"
 * We grab the first "at X (" line. Falls back to "" when the stack is
 * missing or not in the expected format.
 */
function extractFirstComponent(stack: string | null): string {
  if (!stack) return "";
  const match = stack.match(/^\s*at\s+([A-Za-z0-9_$]+)\s*\(/m);
  return match?.[1] ?? "";
}

export default ErrorBoundary;
