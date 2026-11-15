import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  public override render() {
    if (this.state.hasError) {
      return (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
          background: 'rgba(2, 6, 23, 0.95)',
          color: '#f8fafc',
          fontFamily: "'JetBrains Mono', monospace",
          padding: '24px',
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: '#f87171', letterSpacing: '0.08em' }}>
            ⚠ {this.props.fallbackTitle || 'SUBSYSTEM RECOVERY MODE'}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8', maxWidth: '420px', lineHeight: 1.5 }}>
            {this.state.error?.message || 'A runtime anomaly was isolated and prevented system collapse.'}
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              onClick={this.handleReset}
              style={{
                padding: '6px 16px',
                background: 'rgba(56, 189, 248, 0.15)',
                border: '1px solid #38bdf8',
                borderRadius: '6px',
                color: '#38bdf8',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Recover Subsystem
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                padding: '6px 16px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.2)',
                borderRadius: '6px',
                color: '#cbd5e1',
                fontSize: '11px',
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              Reload System
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
