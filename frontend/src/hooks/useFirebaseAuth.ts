import { useState, useEffect } from 'react';
import { User, onAuthStateChanged, signInWithGoogle, signOutUser, auth } from '../firebase';

export function useFirebaseAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser: User | null) => {
      setUser(currentUser);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = async () => {
    setError(null);
    try {
      const signedInUser = await signInWithGoogle();
      return signedInUser;
    } catch (err: any) {
      const message = err?.message || 'Google Sign-In failed';
      setError(message);
      throw err;
    }
  };

  const logout = async () => {
    setError(null);
    try {
      await signOutUser();
    } catch (err: any) {
      const message = err?.message || 'Sign-Out failed';
      setError(message);
      throw err;
    }
  };

  return {
    user,
    loading,
    error,
    signInWithGoogle: login,
    signOut: logout,
  };
}
