# Third-party components

snag uses third-party programs as independent local processes. Versions are recorded in `engine/versions.json`.

- **yt-dlp**: [upstream](https://github.com/yt-dlp/yt-dlp), [release binaries and sources](https://github.com/yt-dlp/yt-dlp/releases), [Unlicense](https://github.com/yt-dlp/yt-dlp/blob/master/LICENSE). The standalone binary bundles additional components; their notices are in `engine/YTDLP-THIRD-PARTY.txt`.
- **FFmpeg / FFprobe**: [upstream source](https://ffmpeg.org/download.html), [license and redistribution information](https://ffmpeg.org/legal.html). The local setup copied the installed [Gyan Windows build](https://www.gyan.dev/ffmpeg/builds/); its sources and build scripts are linked by that distributor. Build configuration and license text are in `engine/FFMPEG-LICENSE.txt`. If setup instead fetched yt-dlp's recommended build, use [FFmpeg-Builds](https://github.com/yt-dlp/FFmpeg-Builds) for its matching build/source information.
- **Deno**: [MIT license and source](https://github.com/denoland/deno), release sources at [Deno releases](https://github.com/denoland/deno/releases). See `engine/DENO-LICENSE.txt`.
- **Tauri**: MIT or Apache-2.0; [source](https://github.com/tauri-apps/tauri).
- **React**: MIT; [source](https://github.com/facebook/react).
- **Astryx**: distributed npm package license; [package](https://www.npmjs.com/package/@astryxdesign/core).
- **Heroicons**: MIT; [source](https://github.com/tailwindlabs/heroicons).

Before redistributing a modified bundle publicly, retain the applicable notices and satisfy the matching FFmpeg build's source-distribution obligations. This repository does not relicense bundled third-party components.
