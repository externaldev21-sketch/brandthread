-- Auto captions / subtitles for video posts (Whisper). Feature flag `autoCaptions` ships OFF.
CREATE TABLE IF NOT EXISTS post_captions (
  post_id     uuid        NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  language    text        NOT NULL,
  status      text        NOT NULL DEFAULT 'pending',
  vtt         text        NOT NULL DEFAULT '',
  segments    jsonb       NOT NULL DEFAULT '[]'::jsonb,
  source      text        NOT NULL DEFAULT 'whisper',
  error       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, language),
  CONSTRAINT post_captions_status_valid CHECK (status IN ('pending', 'ready', 'failed')),
  CONSTRAINT post_captions_source_valid CHECK (source IN ('whisper', 'manual'))
);

INSERT INTO feature_flags (key, enabled, description)
VALUES ('autoCaptions', false, 'Auto-generated captions (subtitles) on video posts')
ON CONFLICT (key) DO NOTHING;
