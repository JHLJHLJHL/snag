# snag
<!-- impeccable:product-schema 1 -->

## Platform
web

## Stack
User requested Rust during implementation. Rust + Tauri own the desktop, queue, persistence, subprocess engine and Chrome native host. React + Astryx render the interface; yt-dlp and FFmpeg remain the media engines. Windows desktop application with an unpacked Chrome extension. No service or account required.

## Users and purpose
The user wants to drag videos from Chrome to a persistent download queue, choose video/audio quality, and save them locally across sites.

## Capabilities and constraints
No login integration, cookie import, credentials or DRM bypass. Public HTTP(S) video files and non-DRM HLS/DASH; site support depends on yt-dlp and detected media. Queue persistence, cancellation, retry, reorder, duplicate detection, presets, quality inspection, an always-on-top drop window, and a Chrome context-menu alternative are in scope. Subtitles, scheduled jobs, clipping and live recording are deferred.

## Implementation assumptions
Korean UI. The app name is snag. One download at a time in version 0.1. New items enter an analysis/ready state so quality can be chosen before starting. Chrome extension installation is manual in developer mode; the app provides a local bridge installation action. No fabricated sample queue.
