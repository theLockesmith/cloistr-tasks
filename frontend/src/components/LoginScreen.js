import React from 'react';
import { LoginModal } from '@cloistr/ui/components';
import { useNostrAuth } from '@cloistr/auth';
import { useAuth } from './AuthContext';

const SIGNER_URL = 'https://signer.cloistr.xyz';

function LoginScreen() {
  const { authState } = useNostrAuth();
  const { loginWithSigner, loading } = useAuth();

  // Called by LoginModal when the user successfully authenticates and the
  // modal closes (NIP-07, NIP-46/bunker, password+nostrconnect, passkey,
  // or Lightning). At this point authState.signer is the connected signer;
  // we hand it straight to loginWithSigner which runs the tasks backend
  // challenge/verify to obtain a JWT — no second connectNip07/connectNip46.
  const handleClose = async () => {
    if (authState.signer) {
      try {
        await loginWithSigner(authState.signer);
      } catch {
        // loginWithSigner sets authError on AuthContext; let it surface there
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
