import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import {
  completePostUpload, dismissPostUpload, startPostUpload, usePostUploadEntry, type PostUploadEntry,
} from '../postUploadProgress';

function current(): PostUploadEntry | null {
  let seen: PostUploadEntry | null = null;
  function Probe() { seen = usePostUploadEntry(); return null; }
  renderToString(createElement(Probe));
  return seen;
}

afterEach(() => {
  dismissPostUpload('p1');
  vi.useRealTimers();
});

describe('post upload pill store', () => {
  it('clears a finished upload after its moment', () => {
    vi.useFakeTimers();
    startPostUpload({ id: 'p1', kind: 'thread' });
    completePostUpload('p1');
    expect(current()?.status).toBe('success');
    vi.advanceTimersByTime(2500);
    expect(current()).toBeNull();
  });

  it("the success auto-clear never removes an upload restarted under the same id", () => {
    vi.useFakeTimers();
    startPostUpload({ id: 'p1', kind: 'thread' });
    completePostUpload('p1');
    startPostUpload({ id: 'p1', kind: 'thread' });
    vi.advanceTimersByTime(2500);
    expect(current()).toMatchObject({ id: 'p1', status: 'uploading' });
  });
});
