import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/** Keeps one broken component from blanking the whole app: shows what went wrong and a way back. */
export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Testimonia crashed:", error, info.componentStack);
  }

  componentDidUpdate(prev: { resetKey?: string }): void {
    // navigating elsewhere gives the page a fresh start
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page crash" role="alert">
        <h1>Something went wrong</h1>
        <p className="muted">This part of Testimonia hit an error. Your notes and settings are safe.</p>
        <pre>{this.state.error.message}</pre>
        <p>
          <button className="btn primary" onClick={() => window.location.reload()}>
            Reload
          </button>{" "}
          <a href="/">Go to the reader</a>
        </p>
      </div>
    );
  }
}
