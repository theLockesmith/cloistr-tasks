import React, { useEffect, useRef } from 'react';
import { LoginModal } from '@cloistr/ui/components';
import { useNostrAuth } from '@cloistr/auth';
import { useAuth } from './AuthContext';

const SIGNER_URL = 'https://signer.cloistr.xyz';

function LoginScreen() {
  const { authState } = useNostrAuth();
  const { loginWithSigner, loading } = useAuth();
  const signerLoginAttempted = useRef(false);

  // Run the tasks backend challenge/verify as soon as a connected signer is
  // available — from EITHER the LoginModal OR a silent SSO restore driven by
  // SharedAuthProvider. Previously login only ran from the modal's onClose,
  // which never fires on the SSO auto-connect path: authState.signer got set
  // but loginWithSigner never ran, so there was no backend JWT and the
  // LoginScreen stayed open despite a completed nostrconnect handshake.
  useEffect(() => {
    if (authState.signer && !signerLoginAttempted.current) {
      signerLoginAttempted.current = true;
      loginWithSigner(authState.signer).catch(() => {
        // loginWithSigner surfaces authError on AuthContext; allow a retry on
        // the next signer change (e.g. the user re-attempts via the modal).
        signerLoginAttempted.current = false;
      });
    }
  }, [authState.signer, loginWithSigner]);

  // The modal's onClose is now just a backstop for the (rare) case where the
  // signer is set and the modal closes before the effect above runs; the ref
  // guard keeps the two paths from double-firing loginWithSigner.
  const handleClose = async () => {
    if (authState.signer && !signerLoginAttempted.current) {
      signerLoginAttempted.current = true;
      try {
        await loginWithSigner(authState.signer);
      } catch {
        signerLoginAttempted.current = false;
      }
    }
    // If signer not yet available (modal closed via Cancel), nothing to do
  };

  if (loading) {
    return (
      <div className="app">
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <LoginModal
        isOpen={true}
        onClose={handleClose}
        signerUrl={SIGNER_URL}
      />
    </div>
  );
}

export default LoginScreen;
