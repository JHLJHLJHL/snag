# StreamDrop design

Based on the user's approved feature discussion and instruction to implement; no login integration.

## Approach
Chosen implementation, revised at the user's request: existing Chrome + MV3 extension + Rust/Tauri desktop app + yt-dlp/FFmpeg. An app-owned browser would not preserve the existing Chrome workflow; a URL-only tool would miss generic detected streams. UI uses React/Astryx and a narrow Tauri command/event API. Native messaging identifies the extension and bridges to an authenticated loopback-only Rust queue service. The same Rust executable handles native messages before GUI startup and reads the running app's connection file; it never reads browser credentials.

## Behavior
Drag a link/thumbnail or an injected media handle into the app/drop window, use Chrome context menu or detected-media popup, or paste HTTP(S) URLs. Analyze asynchronously and store metadata plus actual available formats. Select preset, explicit video/audio formats, language track, output original/MP4/MP3, and video/audio/both. Download one item at a time; distinguish download and conversion. Persist queue atomically, recover interrupted work as paused, allow resume/retry/cancel/reorder, and detect canonical duplicates. Save in an OS-picked directory. Reveal completed files. Never pass untrusted strings to a shell or load yt-dlp user configuration.

## Limits
No universal-download claim, DRM bypass, cookie/login import, auto-added background media, or unlimited playlist ingestion. New items wait for user start. Live streams return a clear unsupported message. Missing engine and Chrome bridge states are visible. Only anonymous requests, optional Referer for public streams. Extension permissions omit cookies.

## Verification
Rust tests for URLs, format selection, queue lifecycle/persistence/cancellation/reordering and native frames. Real local MP4 and HLS fixture downloads through the Rust engine, yt-dlp and FFmpeg. Tauri/WebView2 interaction, authenticated bridge/native executable frames, settings persistence, drop window and extension capture smoke tests. Build portable Windows app directory and document manual extension installation. Desktop source remains Rust even though third-party media engines are bundled binaries.
