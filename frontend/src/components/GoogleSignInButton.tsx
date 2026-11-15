import React from 'react';
import { useFirebaseAuth } from '../hooks/useFirebaseAuth';
import { LogOut, Loader2 } from 'lucide-react';

interface GoogleSignInButtonProps {
  className?: string;
  onSuccess?: () => void;
}

export const GoogleSignInButton: React.FC<GoogleSignInButtonProps> = ({ className = '', onSuccess }) => {
  const { user, loading, error, signInWithGoogle, signOut } = useFirebaseAuth();

  const handleSignIn = async () => {
    try {
      await signInWithGoogle();
      if (onSuccess) onSuccess();
    } catch {
      // Error handled in hook state
    }
  };

  if (loading) {
    return (
      <div className={`google-auth-loading ${className}`} style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: 0.7 }}>
        <Loader2 size={14} className="animate-spin" />
        <span style={{ fontSize: '12px' }}>Checking session…</span>
      </div>
    );
  }

  if (user) {
    return (
      <div className={`google-auth-profile ${className}`} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {user.photoURL && (
          <img
            src={user.photoURL}
            alt={user.displayName || 'Google User'}
            style={{ width: '24px', height: '24px', borderRadius: '50%', objectFit: 'cover', border: '1px solid rgba(255,255,255,0.2)' }}
          />
        )}
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
          <span style={{ fontSize: '12px', fontWeight: 500, color: '#f0f4f8' }}>{user.displayName || 'User'}</span>
          <span style={{ fontSize: '10px', color: '#8899a6' }}>{user.email}</span>
        </div>
        <button
          type="button"
          onClick={signOut}
          title="Sign out of Google"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#a0aec0',
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            marginLeft: '4px'
          }}
        >
          <LogOut size={14} />
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <button
        type="button"
        onClick={handleSignIn}
        className={`google-signin-btn ${className}`}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          background: 'rgba(255, 255, 255, 0.08)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          color: '#ffffff',
          padding: '6px 12px',
          borderRadius: '6px',
          fontSize: '12px',
          fontWeight: 500,
          cursor: 'pointer',
          transition: 'all 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.35)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24">
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
          />
        </svg>
        <span>Sign in with Google</span>
      </button>
      {error && (
        <span style={{ fontSize: '11px', color: '#ff6b6b' }}>
          {error}
        </span>
      )}
    </div>
  );
};
