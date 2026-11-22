# StreamDrop Implementation Plan

> **For agentic workers:** Execute inline using superpowers:executing-plans, with focused test-first Rust core changes.

**Goal:** Working Windows public-video download manager with Chrome drag/drop, using Rust at the user's request.
**Architecture:** Rust/Tauri owns queue, persistence, native messaging and anonymous yt-dlp child processes. React renderer uses a narrow Tauri command/event API. MV3 extension communicates through the same executable's native-host mode and an authenticated loopback service.
**Tech Stack:** Rust, Tokio, Tauri 2, React, Vite, Astryx, yt-dlp, FFmpeg.
**Spec:** ../specs/2026-11-20-streamdrop-design.md

## Global Constraints
No login/cookies/DRM bypass. Korean UI. Public HTTP(S) only. No shell interpolation. Persist queue. Keep app changes in youtube_downloader. Work on codex/video-downloader; leave changes reviewable without committing unrelated parent-project files.

## Review Focus
Reject file/javascript URLs and credentials; recover interrupted transfers without marking complete; cancellation kills process trees; conversion is not marked complete until process success; stale analysis cannot resurrect removed work; signed stream query strings remain intact.

### Task 1: Rust queue and formats
Files: src-tauri/src/{model,store,queue}.rs; src-tauri/tests/{core,queue}.rs.
Interfaces: Queue::new(Store,Arc<dyn MediaEngine>,notify) exposes snapshot/add/update/start/cancel/retry/reorder/settings; Store loads/saves versioned JSON atomically.
- [x] Port behavior tests and implement normalization, actual format options and persistent lifecycle.
- [x] Run npm test: 15 initial Rust tests pass.

### Task 2: Rust engine, desktop and Chrome bridge
Files: src-tauri/src/{engine,desktop,bridge,main}.rs; extension/*; scripts/setup-engine.mjs; src-tauri/tests/{bridge,engine}.rs.
Interfaces: Tauri command(action,payload), queue-changed events; native frames accept enqueue/status only. Engine has cancellable analyze/download and progress callbacks.
- [x] Build native runtime and authenticated native messaging bridge; install local MSVC toolchain without elevation.
- [x] Verify real MP4 download, MP3 conversion, video-only output and explicit HLS 90p selection with FFprobe.
- [x] Verify complete Chrome extension capture, content-button enqueue, duplicate detection, popup and real native messaging with a separate Chrome for Testing profile.

### Task 3: Desktop interface and delivery
Files: src/{App,main}.jsx, src/api.js, scripts/{rust,start,smoke,package}.mjs, README.md.
- [x] Scaffold Astryx shell-side-nav and implement Korean queue, quality inspector, settings and drop window.
- [x] Exercise actual Tauri UI, queue lifecycle, extension and persistence with local fixtures, including restarting the actual process.
- [x] Run npm test (20 passed), production frontend and Rust release builds, real engine fixtures, packaged-app E2E with restart, and actual Chrome extension/native messaging tests.
- [x] Fresh-context code review; reproduce and fix all three material findings with RED→GREEN regression tests. Document installation and tested scope.

## Progress / decisions
- The user switched implementation to Rust after the initial JS core tests passed; transient JS core files were removed after porting to Rust.
- Existing Chrome is retained; extension developer-mode installation remains a user-visible step.
- Windows initially lacked Rust and C++ prerequisites. Rust installed in the user profile; a standalone Microsoft compiler/SDK was downloaded to the task's temporary tools folder, with package hashes checked by the downloader. No administrator changes succeeded or are required for this build.
- Login integration remains excluded. No cookie permission, import or credential forwarding.
- Final review fixed: title-bearing queue serialization; unique per-job/quality staging and no-overwrite exports; generation-protected cancel/retry controllers. Also added orderly process shutdown and its test.
- Release gate passed on the portable binary with its bundled resources. Normalized Windows device-prefixed resource paths for Chrome folder selection. ZIP inventory, executable identity and SHA256 verified. Artifacts: release/StreamDrop-0.1.0-windows-x64/ and matching ZIP.
