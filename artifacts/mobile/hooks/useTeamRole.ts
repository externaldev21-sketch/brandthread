import { useEffect, useState } from 'react';
import { useApi } from '@/lib/api';
import { isTeamRole, type TeamRole } from '@/lib/roleError';

/**
 * Resolves the caller's role in the active store context. This is separate from
 * billing data requests so a manager stays read-only even when a summary fails.
 */
export function useTeamRole() {
  const api = useApi();
  const [currentRole, setCurrentRole] = useState<TeamRole | null>(null);
  const [isLoadingRole, setIsLoadingRole] = useState(true);

  useEffect(() => {
    let active = true;
    setIsLoadingRole(true);

    api.team.context()
      .then(({ role }) => {
        if (active) setCurrentRole(isTeamRole(role) ? role : null);
      })
      .catch(() => {
        if (active) setCurrentRole(null);
      })
      .finally(() => {
        if (active) setIsLoadingRole(false);
      });

    return () => {
      active = false;
    };
  }, [api]);

  return { currentRole, isLoadingRole };
}