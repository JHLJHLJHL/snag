# Verification — 2026-11-21

Latest icon and download fixes:

- Latest typography pass supersedes the per-element sizes below: all visible app and extension text now computes to 14px, including SNAG, all page/section headings and all media segments. SNAG remains uppercase/bold/italic. Footer version label reads `snag · beta`. Checked all screens, menus, the 310×210 drop window, extension popup and capture button.
- Media segments (영상 + 음성 / 영상만 / 음성만) use 12px. The download settings heading, queue/completed page headings and empty-state heading use 13px. Computed-style checks and queue/completed-empty screenshots verified the targeted sizes.
- Main header brand reads `SNAG` at 16px, italic, weight 700. Computed styles and screenshot verified; the other UI text remains 14px.
- Unified every font-size and semantic text-size token in the local `snag` theme to 14px, including headings, menus, buttons, captions and counts. Extension popup and capture-button text also use 14px. Browser computed-style checks passed for the queue, format menu, settings, connection screen, 310×210 drop window, extension popup and capture button; screenshots were inspected. The editor's standalone PNG renderer could not import its generated CSS, so visual verification used the actual app via Vite instead. `astryx doctor --built dist` passed with no failures.
- Taskbar icon framing fills about 99% of the available width, enlarging the transparent character by about 16%. Both main and drop windows share this framing.
- Extracted the release executable's 16/32/48 icons and inspected them. Refreshed the Windows Shell icon cache; confirmed the actual Explorer list view shows the new character. Packaging now sends the same Shell refresh notification after replacing executable files.
- Applied the supplied color icon set: tile icons for the executable and favicon, transparent character for the main brand and both windows' taskbar icons. Verified the taskbar PNG has transparent corners and inspected the built executable icon and main UI screenshot.
- Default video output is MP4. Version 1 video defaults and unfinished original-format jobs migrate once; completed files and audio options remain intact.
- `npm test`: 25 tests passed, including failing-before-fix regressions for MP4 output and persisted queue migration.
- `npm run test:engine`: real WebM-to-MP4, video-only MP4, MP3, original mode and HLS 90p downloads passed FFprobe stream checks.
- Packaged release `npm run test:e2e`: passed, including clicking “저장한 파일 보기” and checking Explorer's actual selected file in a Korean path containing spaces. The original executable failed this regression. File selection now uses the Windows Shell API.
- `npm run package` and `npx astryx doctor --built dist` passed (zero Astryx failures). Updated portable app and ZIP: `release/snag-0.1.0-windows-x64`; archive checksum: `release/snag-SHA256SUMS.txt`.

## Earlier verification — 2026-11-20

The final implementation is Rust/Tauri, with React/Astryx rendering and independent yt-dlp/FFmpeg/Deno media programs.

- `npm test`: 20 Rust tests passed, including shutdown rejecting late work. The real-media test is intentionally separate and marked ignored in this fast suite.
- `npm run test:engine`: generated local MP4 and two-resolution HLS media; actual Rust engine downloads, MP3 conversion, video-only conversion and explicit HLS 90p selection were checked with FFprobe. Downloading the same source as video-only in the same output directory preserves the earlier full video's bytes.
- `npm run test:e2e`: actual Tauri/WebView2 app, Native Messaging executable framing, token/origin rejection, URL entry, actual quality selector, real queued MP4/HLS downloads, completed files, default settings, always-on-top drop window, and drop event. Restarting the process retains all titled queue entries, completion history and defaults.
- `npm run test:extension`: separate actual Chrome for Testing profile, loaded MV3 extension, HTTP media request detection, content capture button, Chrome Native Messaging to the Rust executable, deduplication and popup connection/list. Test-only native host registrations are removed afterward.
- `npx astryx doctor --built dist`: zero failures. Existing CLI-path/theme integration advisories do not block the build.
- Impeccable mechanical detector: no findings. Desktop and drop-window screenshots visually checked; Chrome popup screenshot checked.
- Fresh reviewer found three material issues. Each was reproduced with a failing Rust test, fixed, and verified in the green full suite: duplicate serialized titles, reuse/modification of completed files, and an immediate-retry cancellation race.

Screenshots and generated media live in ignored `.test-artifacts/`. These tests prove the local end-to-end integration; they do not establish universal compatibility with arbitrary public sites or access-restricted/DRM content. Installation in the user's everyday Chrome profile is a separate manual developer-mode step described in README.

`npm run package` passed. Release portable binary and bundled resources also passed the full Tauri E2E/restart test and actual Chrome extension test. ZIP inventory and executable identity checked; archive SHA256 is in `release/SHA256SUMS.txt`. Output: `release/StreamDrop-0.1.0-windows-x64/streamdrop.exe` and matching ZIP (240.3 MB including all media engines).
