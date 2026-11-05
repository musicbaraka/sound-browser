# Sound Browser

A desktop app for browsing, searching and auditioning every sound in your folders.

- Add folders once. They are remembered and rescanned on every launch, and new sounds appear on their own.
- Plays WAV, AIFF, MP3, FLAC, OGG, M4A and more, with a clickable waveform.
- Shows length, sample rate, bit depth and channels. All of it is cached, so big libraries open fast.
- Favorites, search, filters and your last session are saved.
- Drag any sound straight into a DAW, a video editor or a folder.
- Updates itself from this repository's GitHub Releases.

## Install (Windows)

Download `Sound-Browser-Setup-x.y.z.exe` from the latest release and run it. Windows SmartScreen may warn that the app is unrecognized because it is not code-signed yet. Click **More info**, then **Run anyway**. This happens only on the first install.

## Where the app keeps its memory

`%APPDATA%\Sound Browser\`

- `library.json`: your folders, favorites and last session
- `index.json`: cached sound info (length, format)
- the waveform cache is in the app's internal database

Uninstalling the app keeps these files, so reinstalling restores everything.

## Keyboard

| Key | Action |
| --- | --- |
| Up / Down | Move through the list (plays each sound if "Play on select" is on) |
| Space | Play / stop |
| Left / Right | Seek 2 seconds |
| Enter | Play from the start |
| F | Favorite |
| E | Show in Explorer |
| L | Loop |
| / | Search |

## Releasing a new version

1. Bump the version: `npm version patch --no-git-tag-version`
2. Build and publish: `GH_TOKEN=... npm run release`

electron-builder uploads the installer, `latest.yml` and the blockmap to a GitHub Release. Installed copies check for updates at launch and every 30 minutes, download in the background, and show a "Restart now" button. If ignored, the update installs when the app is closed.

## Development

```
npm install
npm start
```
