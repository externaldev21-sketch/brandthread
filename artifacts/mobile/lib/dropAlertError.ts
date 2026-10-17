import { apiErrorMessage } from './safety';
import { ApiError } from './networkNotice';

/**
 * Title + message for a failed drop "Notify me" toggle. Only a 401 (the
 * buyer isn't signed in / their session expired) asks them to sign in; any
 * other failure shows the server's actual reason (or a generic network
 * message for 5xx / non-HTTP errors) so signed-in buyers aren't told to sign
 * in when something else went wrong.
 */
export function dropAlertErrorCopy(error: unknown, retryHint = 'tap Notify me again'): { title: string; message: string } {
  if (error instanceof ApiError && error.status === 401) {
    return {
      title: 'Sign in to get drop alerts',
      message: `Create or sign in to your buyer account, then ${retryHint}.`,
    };
  }
  return {
    title: 'Couldn’t update drop alert',
    message: apiErrorMessage(error, 'Check your connection and try again.'),
  };
}
