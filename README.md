# opticast

Turn any file into a video of encrypted 2D barcodes, play it on one screen,
point a phone at it, and get the file back.

There is no network path between the two halves. The video *is* the transport —
the only channel is a camera looking at a display.

```
file ──▶ AES-256-GCM ──▶ chunks ──▶ QR frames ──▶ ffmpeg ──▶ video.mp4
                                                                │
                                                          (a screen)
                                                                │
file ◀── verify SHA-256 ◀── decrypt ◀── reassemble ◀── camera ◀──┘
```

## Packages

| Package              | Description                                                  |
| -------------------- | ------------------------------------------------------------ |
| `packages/protocol`  | Frame format, Base45, crypto, reassembly. Shared by all apps. |
| `packages/api`       | Node/Express backend that renders the videos.                 |
| `packages/dashboard` | React dashboard to create and manage streams.                 |
| `packages/scanner`   | Expo (React Native) app that scans a video back into a file.  |

## Requirements

- Node 20+
- **ffmpeg** — bundled via `ffmpeg-static`, so nothing to install. Override with
  `FFMPEG_PATH`. `ffprobe` is optional and only enriches media metadata.

## Running it

```sh
yarn install
yarn dev        # api on :3000, dashboard on :4200
```

Open <http://localhost:4200>, pick a file, optionally set a PIN, and create a
stream. When it finishes encoding, hit **Play for scanning**.

Then, in a second terminal:

```sh
yarn scanner    # Expo dev server; open it on a phone
```

Point the phone at the playing video. The app reads the metadata barcode first
(filename, size, how many frames to expect, whether a PIN is needed), fills a
progress bar as frames arrive, asks for the PIN, verifies the checksum, and
offers to save — with an inline preview for images, audio and video.

## Getting the scanner onto a phone

Three routes, cheapest first.

### Expo Go — nothing to build

Install **Expo Go** from the App Store, put the phone on the same Wi-Fi as your
machine, run `yarn scanner`, and scan the terminal QR with the built-in
Camera app. Every native module the scanner uses — camera, media library,
file system, video, audio, sharing — ships inside Expo Go, so this is the
normal development loop. Add `--tunnel` if the network blocks device-to-device
traffic:

```sh
yarn nx start scanner --tunnel
```

### A local native build — Xcode, phone on a cable

Worth it when Expo Go's camera pipeline isn't representative, or when you need
to exercise save-to-library against a real signed app.

```sh
yarn scanner:prebuild   # generate packages/scanner/ios from app.json
yarn scanner:ios        # build, sign, install on the connected device
```

`ios/` is generated, not committed. `app.json` is the source of truth, so after
changing a plugin or a permission string, re-run prebuild instead of editing
the Xcode project. Signing a build for a physical device needs an Apple ID;
`expo run:ios` will prompt and set up free provisioning if you have no paid
account.

### EAS cloud builds — Expo account

Needs `npm i -g eas-cli`. The profiles live in `packages/scanner/eas.json`.

```sh
yarn scanner:build:dev       # dev client, internal distribution
yarn scanner:build:preview   # internal distribution / simulator
yarn scanner:build           # production
yarn scanner:submit          # push the latest build to App Store Connect
```

`scanner:build:dev` is the one to reach for if you ever add a library Expo Go
doesn't bundle: install the resulting dev client once, then keep using
`yarn scanner` against it.

## Configuration

Set on the create form, per stream:

| Setting                 | Default | Notes                                              |
| ----------------------- | ------- | -------------------------------------------------- |
| `width`                 | 1080    | Output video is square.                            |
| `fps`                   | 8       | Must stay within the scanner's detection rate.     |
| `payloadBytes`          | 400     | Bytes per frame. **The setting that matters.**     |
| `ec`                    | M       | QR error correction: L, M, Q, H.                   |
| `margin`                | 2       | Quiet zone, in QR modules.                         |
| `metadataRepeatEvery`   | 40      | Lets a scanner join mid-playback. 0 disables.      |
| `frameRepeat`           | 1       | Hold each barcode for N video frames.              |

Server-side env: `PORT`, `HOST`, `DATA_DIR`, `MAX_UPLOAD_BYTES`, `FFMPEG_PATH`,
`FFPROBE_PATH`.

## Throughput, honestly

At the defaults this moves about **3.2 KB/s**. A 1 MB file is roughly five
minutes of video. That is inherent: a QR code holds a couple of kilobytes at
best, and pushing `payloadBytes` up shrinks the modules until a phone can no
longer read them off a screen.

The defaults were picked by measuring, not guessing — decoding rendered streams
at progressively harsher downscales, as a proxy for camera distance:

| payload | 1080px | 720px | 540px | 360px | 270px |
| ------- | ------ | ----- | ----- | ----- | ----- |
| 300     | 100%   | 100%  | 100%  | 100%  | 100%  |
| **400** | 100%   | 100%  | 100%  | 100%  | 100%  |
| 600     | 100%   | 100%  | 100%  | 100%  | 0%    |
| 1200    | 100%   | 100%  | 0%    | 0%    | 0%    |

Raise `payloadBytes` only for a large display with the phone held close.

## Security

The file is encrypted whole with AES-256-GCM before chunking, keyed by
PBKDF2-SHA256 over the PIN. The metadata frame stays in the clear so the scanner
can discover the file layout and know a PIN is required.

A numeric PIN has a small keyspace, so key stretching raises the cost per guess
but cannot make a stolen video brute-force-proof. The real barrier is that an
attacker needs the video. Use a long PIN for anything sensitive.

## Development

```sh
yarn verify           # typecheck + test everything, build the buildables
yarn bundle-scanner   # Metro bundle of the Expo app
yarn nx graph             # project graph
```

`yarn bundle-scanner` is the real check that the Expo app compiles — `verify`
does not cover it, because the scanner has no build target of its own.

The `scanner:build*` scripts are EAS **cloud** builds and need an Expo account,
so they are deliberately outside `verify`.
