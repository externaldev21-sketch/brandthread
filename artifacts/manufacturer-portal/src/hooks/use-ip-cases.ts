import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/react';

export interface IpCase {
  id: string;
  publicReference: string;
  claimantName: string;
  claimantEmail: string;
  claimantContact: string | null;
  listingProductId: string | null;
  listingUrl: string | null;
  rightsType: string;
  description: string;
  evidenceReferences: string[];
  status: 'submitted' | 'under_review' | 'information_requested' | 'dismissed' | 'actioned';
  moderatorNotes: string | null;
  assignedModeratorId: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  listingContext: {
    id: string;
    name: string;
    description: string | null;
    status: string;
    ownerId: string;
    images: string[];
    updatedAt: string;
  } | null;
}

export interface AuditLog {
  id: string;
  caseId: string;
  action: string;
  previousStatus: string | null;
  nextStatus: string | null;
  actorId: string | null;
  details: Record<string, unknown>;
  createdAt: string;
}

export function useIsModerator() {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ['is-moderator'],
    queryFn: async () => {
      try {
        const token = await getToken();
        if (!token) return false;
        const res = await fetch('/api/ip-cases/access', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.status === 401 || res.status === 403) return false;
        if (!res.ok) return false;
        const body = await res.json() as { moderator?: boolean };
        return body.moderator === true;
      } catch {
        return false;
      }
    },
    staleTime: 1000 * 60 * 60, // Cache for 1 hour
    retry: false
  });
}

export function useIpCases(status?: string) {
  const { getToken } = useAuth();
  
  return useQuery({
    queryKey: ['ip-cases', status],
    queryFn: async () => {
      const token = await getToken();
      const url = status && status !== 'all' ? `/api/ip-cases?status=${status}` : '/api/ip-cases';
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) throw new Error('Unauthorized');
        throw new Error('Failed to fetch IP cases');
      }
      return res.json() as Promise<IpCase[]>;
    },
    retry: false
  });
}

export function useIpCaseAudit(id: string | null) {
  const { getToken } = useAuth();
  
  return useQuery({
    queryKey: ['ip-cases', id, 'audit'],
    queryFn: async () => {
      if (!id) return [];
      const token = await getToken();
      const res = await fetch(`/api/ip-cases/${id}/audit`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        throw new Error('Failed to fetch audit log');
      }
      return res.json() as Promise<AuditLog[]>;
    },
    enabled: !!id
  });
}

export function useUpdateIpCase() {
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async ({ id, data }: {
      id: string;
      data: {
        status?: IpCase['status'];
        moderatorNotes?: string;
        action?: 'hide_listing' | 'remove_listing';
      };
    }) => {
      const token = await getToken();
      const res = await fetch(`/api/ip-cases/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || 'Failed to update case');
      }
      return res.json() as Promise<IpCase>;
    },
    onSuccess: (updatedCase) => {
      // Patch local cache
      queryClient.setQueryData(['ip-cases', updatedCase.status], (old: IpCase[] | undefined) => {
        if (!old) return old;
        return old.map(c => c.id === updatedCase.id ? updatedCase : c);
      });
      queryClient.setQueryData(['ip-cases', 'all'], (old: IpCase[] | undefined) => {
        if (!old) return old;
        return old.map(c => c.id === updatedCase.id ? updatedCase : c);
      });
      // Invalidate to refresh fully
      queryClient.invalidateQueries({ queryKey: ['ip-cases'] });
    }
  });
}
