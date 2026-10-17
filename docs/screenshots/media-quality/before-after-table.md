| Path | Before: resolution | Before: quality | Before: size | After: resolution | After: quality | After: size |
|---|---|---|---|---|---|---|
| Threads slideshow 3:4 (12MP photo) | 810x1080 | 4 JPEG encodes (crop 0.92 → prep 0.8 → server q80 → ffmpeg -q:v 3, 4:2:0); **SSIM 0.5015** | 0.09 MB | 1080x1440 | crop q1.0 → 1 server encode (q92 libjpeg 4:4:4, lanczos); **SSIM 0.8109** | 0.52 MB |
| Threads slideshow 9:16 (12MP photo) | 720x1280 | 4 JPEG encodes (crop 0.92 → prep 0.8 → server q80 → ffmpeg -q:v 3, 4:2:0); **SSIM 0.4800** | 0.12 MB | 1080x1920 | crop q1.0 → 1 server encode (q92 libjpeg 4:4:4, lanczos); **SSIM 0.9210** | 0.81 MB |
| Avatar photo | 1080x1080 | 3 encodes (picker 0.9 → prep 0.8 → server q80); **SSIM 0.7340** | 0.20 MB | 1080x1080 | picker q1.0 → 1 server encode (q90 4:4:4); **SSIM 0.7852** | 0.33 MB |
| Product photo 3:4 | 1536x2048 | 4 encodes (0.9 → crop 0.92 → prep 0.8 → q80, 2048 cap); **SSIM 0.9320** | 0.63 MB | 2160x2880 | picker q1.0, crop q1.0 → 1 server encode (q90 4:4:4, 2160 wide); **SSIM 0.9920** | 2.09 MB |
| Chat photo | 1536x2048 | 2 encodes (picker 0.85 → server q80, 2048 cap); **SSIM 0.9317** | 0.63 MB | 2160x2880 | picker 0.9 → 1 server encode (q90 4:4:4, 2160 wide); **SSIM 0.9936** | 2.19 MB |
| Post video, 1080p30 H.264 clip, no edits | 1080x1920 | h264 30fps 9.3 Mb/s, ?, aac 44kHz 128k | 8.87 MB | 1080x1920 | h264 30fps 15.3 Mb/s, ?, aac 48kHz 159k — **original kept (remux only)** | 14.63 MB |
| Post video, 4K60 HEVC HLG clip | 1080x1920 | h264 30fps 7.6 Mb/s, arib-std-b67, aac 44kHz 127k | 5.46 MB | 1080x1920 | h264 60fps 13.5 Mb/s, bt709, aac 48kHz 191k | 9.70 MB |
| POST carousel video (3:4 crop) | 1080x1440 | h264 30fps 8.7 Mb/s, ?, aac 44kHz 128k | 8.34 MB | 1080x1440 | h264 30fps 13.1 Mb/s, bt709, aac 48kHz 189k | 12.47 MB |
| Profile cover video | 720x1280 | h264 30fps 1.0 Mb/s, ?, no audio | 0.92 MB | 1080x1920 | h264 30fps 13.0 Mb/s, bt709, no audio | 12.39 MB |
| Avatar video | 480x480 | h264 30fps 0.3 Mb/s, ?, no audio | 0.25 MB | 800x800 | h264 30fps 6.5 Mb/s, bt709, no audio | 6.16 MB |
| Post video, 1080p30 clip **with** edits (re-encoded) | — | — | — | 1080x1920 | h264 30fps 13.2 Mb/s, bt709, aac 48kHz 191k | 12.61 MB |
| Threads slideshow 3:4 (12MP photo) — grid thumbnail | 360x480 | ffmpeg -q:v 4 | 0.02 MB | 540x720 | q88, lanczos | 0.05 MB |
| Threads slideshow 9:16 (12MP photo) — grid thumbnail | 360x640 | ffmpeg -q:v 4 | 0.02 MB | 540x960 | q88, lanczos | 0.08 MB |
