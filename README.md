# BotDrafts Screen Helper

A local Windows helper that reads a mirrored Brawl Stars ranked draft and fills in a local BotDrafts page. It detects the map, revealed bans, locked picks, and first-pick order.

The helper reads the phone screen through ADB, using the same connection as scrcpy. It does not tap the phone or choose brawlers in the game.

## Windows executable

Download **BotDrafts-Helper.exe** from the repository's Releases page and double-click it. The executable includes Node.js, the reader, and its reference data. Node.js and npm do not need to be installed separately.

On first launch it unpacks its files into `%LOCALAPPDATA%\BotDraftsHelper\versions`. It opens the local BotDrafts page in your browser and keeps a small tray icon for reopening or quitting the helper. If the helper is already running, another launch opens the existing reader.

Keep scrcpy installed and your phone connected as usual. The executable is for 64-bit Windows 10/11.

## Requirements for running from source

- Windows with Node.js 24 or newer and npm.
- scrcpy and its included ADB, with an authorized Android phone connected.
- Internet access for initial setup and refreshing BotDrafts data.

## Set up

Clone or download this repository. On Windows, run **Set up BotDrafts.cmd** once. Alternatively, from the repository folder:

```sh
npm ci
npm run setup
```

Setup downloads the public BotDrafts page and recommendation data, brawler artwork, and English OCR data. These generated files are excluded from Git. The setup process does not need an API key.

## Use

1. Connect the phone and open scrcpy as usual.
2. Double-click **Start BotDrafts.vbs** or **Start BotDrafts.cmd**. You can also run `npm start`.
3. Open <http://127.0.0.1:8766/#draft> and press **Start reading**.
4. Draft on the phone. Use this local browser tab for automatic input.

**Fast updates** is enabled by default. Especially clear bans and locked picks update after one scan; other portraits receive additional checks. Turn it off for extra confirmation on every brawler.

**Check reads** lets you correct the map, first-pick side, or a brawler. Manual corrections stay fixed for that draft. **New draft** clears the draft and its corrections. **Pause** stops capture; **Close helper**, under Check reads, stops the local server.

While enabled, the reader waits for a disconnected phone and resumes when it reconnects. It automatically adjusts when the game shifts its team panels for the camera cutout.

## Refresh recommendations

Use **Check reads → Refresh BotDrafts stats**, then resume reading. BotDrafts and game UI changes can require updating this helper. Skins and ambiguous portraits can still need a manual correction.

## Configuration

- `ADB_PATH`: optional full path to `adb.exe` if it is not on PATH or found in a WinGet scrcpy installation.
- `BOTDRAFTS_PORT`: optional local port; defaults to `8766`.

The browser-facing service listens on loopback only. This project requires a local phone connection; publishing the source to GitHub does not turn it into a remotely hosted phone reader.

## Development

```sh
npm test
```

To build the self-contained Windows executable after setup, run `npm run build:windows` on Windows. The build uses the Windows .NET Framework C# compiler, embeds the installed Node.js runtime and app dependencies, and writes `dist/BotDrafts-Helper.exe`. Build output is excluded from Git. A release build can be verified with `BotDrafts-Helper.exe --self-test report.json`; this uses an isolated local test port and then stops its test server.

Tests cover draft confirmation, fast updates, hidden bans, pre-picks, manual corrections, and resetting for a new draft. Screenshot-recognition checks were also performed locally against captured drafts; personal screen captures are not included in this repository.

## Privacy and credits

Normal screen reading keeps the latest phone image in memory on the computer. Screenshots are not uploaded. No startup task is installed.

Recommendation logic and the downloaded page come from [BotDrafts](https://botdrafts.pages.dev/). This helper adds screen reading and local integration. The original page's attribution remains intact.

Brawler artwork comes from [Brawlify CDN](https://github.com/Brawlify/CDN), with the catalog from [BrawlAPI](https://brawlapi.com/). OCR uses [Tesseract.js](https://github.com/naptha/tesseract.js); image processing uses [sharp](https://sharp.pixelplumbing.com/). Their respective licenses apply to those dependencies and downloaded materials. They are downloaded during setup, rather than committed here.

This is an unofficial fan tool and is not endorsed by Supercell or the BotDrafts author.
