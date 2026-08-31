import { describe, expect, it } from 'vitest';
import { ApiError } from './networkNotice';
import { parseRoleError } from './roleError';

const roleResponse = {
  error: {
    code: 'ROLE_REQUIRED',
    message: 'Owner access is required.',
    details: { requiredRole: 'owner', currentRole: 'manager' },
  },
  requestId: 'request-role-test',
};

describe('parseRoleError', () => {
  it('recognizes the structured ApiError returned by the API client', () => {
    expect(parseRoleError(new ApiError(403, JSON.stringify(roleResponse)))).toEqual({
      code: 'ROLE_REQUIRED',
      requiredRole: 'owner',
      currentRole: 'manager',
      message: 'Owner access is required.',
    });
  });

  it('keeps compatibility with legacy serialized 403 errors', () => {
    expect(parseRoleError(new Error(`API 403: ${JSON.stringify({
      code: 'ROLE_REQUIRED',
      requiredRole: 'owner',
      currentRole: 'staff',
      message: 'Owner access is required.',
    })}`))?.currentRole).toBe('staff');
  });

  it('does not classify non-role API failures as owner permission changes', () => {
    expect(parseRoleError(new ApiError(500, JSON.stringify(roleResponse)))).toBeNull();
    expect(parseRoleError(new ApiError(403, JSON.stringify({
      error: { code: 'INTERNAL_ERROR', message: 'Try again.' },
    })))).toBeNull();
  });
});