import { useCallback, useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import { useAuth } from '@clerk/expo';
import { isTeamRole, type TeamRole } from '@/lib/roleError';

/**
 * Resolves the caller's role in the active store context. This is separate from
 * billing data requests so a manager stays read-only even when a summary fails.
 */
export function useTeamRole() {
  const api = useApi();
  const { isLoaded, isSignedIn } = useAuth();
  const [currentRole, setCurrentRole] = useState<TeamRole | null>(null);
  const [isLoadingRole, setIsLoadingRole] = useState(true);
  // A failed lookup is not "not the owner": screens offer a retry (QA-0049).
  const [roleError, setRoleError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    // Never call the protected team-context API without a loaded, signed-in session.
    if (!isLoaded || !isSignedIn) {
      setCurrentRole(null);
      setRoleError(false);
      setIsLoadingRole(false);
      return;
    }
    setIsLoadingRole(true);
    setRoleError(false);

    api.team.context()
      .then(({ role }) => {
        if (active) setCurrentRole(isTeamRole(role) ? role : null);
      })
      .catch(() => {
        if (active) { setCurrentRole(null); setRoleError(true); }
      })
      .finally(() => {
        if (active) setIsLoadingRole(false);
      });

    return () => {
      active = false;
    };
  }, [api, isLoaded, isSignedIn, attempt]);

  const retryRole = useCallback(() => setAttempt((n) => n + 1), []);
  return { currentRole, isLoadingRole, roleError, retryRole };
}