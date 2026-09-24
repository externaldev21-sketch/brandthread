import { describe, expect, it } from 'vitest';
import { advance, classifyGesture, nextUser, prevUser, retreat } from './storyViewerNav';

describe('story viewer navigation', () => {
  describe('advance (tap right / auto-advance)', () => {
    it('steps to the next slide within the same user', () => {
      expect(advance(0, 0, [3, 2])).toEqual({ storyIdx: 0, slideIdx: 1, shouldClose: false });
    });
    it('rolls over to the next user once slides are exhausted', () => {
      expect(advance(0, 2, [3, 2])).toEqual({ storyIdx: 1, slideIdx: 0, shouldClose: false });
    });
    it('closes the viewer after the last slide of the last user', () => {
      expect(advance(1, 1, [3, 2])).toEqual({ storyIdx: 1, slideIdx: 1, shouldClose: true });
    });
  });

  describe('retreat (tap left edge)', () => {
    it('steps to the previous slide within the same user', () => {
      expect(retreat(0, 2, [3, 2])).toEqual({ storyIdx: 0, slideIdx: 1, shouldClose: false });
    });
    it('jumps to the last slide of the previous user at the first slide', () => {
      expect(retreat(1, 0, [3, 2])).toEqual({ storyIdx: 0, slideIdx: 2, shouldClose: false });
    });
    it('stays put at the very first slide of the first user', () => {
      expect(retreat(0, 0, [3, 2])).toEqual({ storyIdx: 0, slideIdx: 0, shouldClose: false });
    });
  });

  describe('swipe between users', () => {
    it('nextUser jumps straight to the next user, resetting to their first slide', () => {
      expect(nextUser(0, 3)).toEqual({ storyIdx: 1, slideIdx: 0, shouldClose: false });
    });
    it('nextUser closes the viewer when already on the last user', () => {
      expect(nextUser(2, 3)).toEqual({ storyIdx: 2, slideIdx: 0, shouldClose: true });
    });
    it('prevUser jumps straight to the previous user, resetting to their first slide', () => {
      expect(prevUser(2)).toEqual({ storyIdx: 1, slideIdx: 0, shouldClose: false });
    });
    it('prevUser stays put when already on the first user', () => {
      expect(prevUser(0)).toEqual({ storyIdx: 0, slideIdx: 0, shouldClose: false });
    });
  });

  describe('classifyGesture', () => {
    it('classifies a firm leftward swipe as next-user', () => {
      expect(classifyGesture(-90, 5)).toBe('next-user');
    });
    it('classifies a firm rightward swipe as prev-user', () => {
      expect(classifyGesture(90, 5)).toBe('prev-user');
    });
    it('classifies a firm downward swipe as close', () => {
      expect(classifyGesture(5, 120)).toBe('close');
    });
    it('ignores small jitter below the swipe threshold', () => {
      expect(classifyGesture(10, 5)).toBe('none');
    });
    it('does not close on a small downward drag', () => {
      expect(classifyGesture(5, 40)).toBe('none');
    });
  });
});
