# Sound Browser

By Elyxium Corporation Labs.

A desktop app for browsing, searching and auditioning every sound in your folders.

- Add folders once. They are remembered and rescanned on every launch, and new sounds appear on their own.
- Plays WAV, AIFF, MP3, FLAC, OGG, M4A and more, with a clickable waveform.
- Shows length, sample rate, bit depth and channels. All of it is cached, so big libraries open fast.
- Search forgives spelling mistakes ("snair" finds snare) and shows what it corrected.
- Musical key and BPM for every sound: read from file names and tags, or detected by listening in the background. Filter by key and BPM range.
- Your own tags, searchable and listed in the sidebar. Right-click to tag every sound shown at once.
- Favorites, search, filters and your last session are saved.
- Drag any sound straight into a DAW, a video editor or a folder.
- Quick edits: select part of a sound, change speed and pitch (independently, or linked like tape), volume, fades, reverse and normalize. Then drag the result into any folder, or save it next to the original. Originals are never changed.
- Noise reduction: select a stretch of pure noise, click Learn noise, then set Clean. Without a learned profile the noise floor is estimated automatically.
- Live spectrum analyzer with peak hold and note readout, plus a spectrogram view of the sound (press S).
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
| R | Reverse the edit |
| S | Switch waveform / spectrogram |
| Esc | Clear the selection |
| / | Search |

## Releasing a new version

```
scripts/release.sh patch
```

This bumps the version in `package.json` and pushes to `main`. The "Build and release" GitHub Action then builds the installer on Windows and publishes it as a GitHub Release (about 5 minutes). Pushes that do not change the version are ignored by the release step.

Installed copies check for updates at launch and every 30 minutes, download in the background, and show a "Restart now" button. If ignored, the update installs when the app is closed.

## Development

```
npm install
npm start
```
