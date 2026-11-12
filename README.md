# Sound Browser

By Elyxium Corporation Labs.

A desktop app for browsing, searching and auditioning every sound in your folders.

- Add folders once. They are remembered and rescanned on every launch, and new sounds appear on their own.
- Plays WAV, AIFF, MP3, FLAC, OGG, M4A and more, with a clickable waveform.
- Shows length, sample rate, bit depth and channels. All of it is cached, so big libraries open fast.
- Search forgives spelling mistakes ("snair" finds snare), shows what it corrected, and suggests "Did you mean…?" when a more common spelling exists.
- Generate sound effects from a description with your own ElevenLabs API key (Settings). They are saved in a Generated folder, added to the library and tagged automatically.
- Musical key and BPM for every sound: read from file names and tags, or detected by listening in the background. Filter by key and BPM range.
- Your own tags, searchable and listed in the sidebar. Right-click to tag every sound shown at once.
- Resizable layout: drag any column edge like a spreadsheet (double-click to fit), and the edges of the sidebar, waveform and spectrum panel.
- Drag a highlighted part straight out of the waveform into any folder or DAW.
- Settings tab: manage library folders, turn key and tempo detection on or off, reset the layout, open the app data folder.
- Favorites, search, filters, layout and your last session are saved.
- Drag any sound straight into a DAW, a video editor or a folder.
- Quick edits: select part of a sound, change speed and pitch (independently, or linked like tape), volume, fades, reverse and normalize. Then drag the result into any folder, or save it next to the original. Originals are never changed.
- Place it: put a sound in a space (rooms, church, cathedral, airport, garage, tunnel, stadium), behind a wall (next room, neighbor's apartment), on a device (telephone, old radio, megaphone), far away or underwater, with the reverb tail kept.
- Maximizer with a true-peak look-ahead limiter: make sounds louder, with every peak held under the ceiling you choose.
- Clean: pick a preset (Reduce background noise, Remove hiss, Remove hum and buzz, Remove rumble, Clean up voice) and set the strength. Hum is found automatically at 50 or 60 Hz and only its overtones are cut. For stubborn noise, select a stretch of pure noise and click Learn noise.
- Live spectrum analyzer with peak hold and note readout, plus a spectrogram view of the sound (press S).
- Graphic EQ: click EQ on the spectrum (or press Q) and drag any of the 10 bands up or down, from -12 to +12 dB. The curve is drawn over the spectrum and you hear it live while the sound plays. Double-click a band to reset it, Flat resets them all.
- Spectral repair: in Spectrogram view, pick Box (B) or Brush (P) and mark a cough, click, squeak or ring. Heal (H) rebuilds that spot from the sound around it, Remove (Delete) silences it, Reduce turns it down by 6, 12 or 20 dB. Ctrl+Z undoes each fix, Reset goes back to the original. Shift adds to a selection.
- Convert: press C, click Convert, or right-click a sound. Choose MP3 (128, 192, 256 or 320 kbps), WAV, AIFF or FLAC and see the file size for each choice. Drop any file onto the converter to convert it instead. Saves next to the original or in a folder you choose, and never overwrites anything.
- Updates itself from this repository's GitHub Releases.

## Install (Mac)

Download `Sound-Browser-x.y.z-mac-arm64.dmg` for Apple Silicon Macs (M1, M2, M3, M4) or `Sound-Browser-x.y.z-mac-x64.dmg` for Intel Macs. Open it and drag Sound Browser into Applications. The Mac version is not signed with an Apple Developer ID yet, so the first time, macOS blocks it: open System Settings, then Privacy & Security, and click Open Anyway. New versions are announced in the app with a Download button.

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
