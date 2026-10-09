export interface CaptionSegment {
  start: number;
  end: number;
  text: string;
}

/** The segment covering `time` (seconds), or null between cues. Segments are ordered by start. */
export function activeCaptionSegment(segments: CaptionSegment[], time: number): CaptionSegment | null {
  for (const segment of segments) {
    if (time >= segment.start && time < segment.end) return segment;
    if (segment.start > time) break;
  }
  return null;
}
