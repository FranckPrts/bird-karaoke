# Bird Karaoke

Bird Karaoke was made so members of the Wild Cornell Bird Watching Club could have fun imitating complex bird calls with our poor human vocal boxes.

## Getting started

1. **Install dependencies** (once per clone):

   ```bash
   npm install
   ```

2. **Run the dev server**:

   ```bash
   npm run dev
   ```

3. **Open the app** in your browser at [http://localhost:3000](http://localhost:3000).

4. **Microphone** — In **Sing** mode, when you record your mimic, the browser will ask for microphone access. Allow it for the recording step to work.

No API keys or `.env` file are required for local play.

## What the app does

From the home screen you can:

- **Sing** — Pick a bird and recording, listen to the reference call, then record yourself. You get a score by comparing your performance to an optional “note mask” (see below).
- **Recognize** — Placeholder; not implemented yet.
- **Editor** — For maintainers: open a bird recording, paint a mask over the spectrogram of the important notes, and save. That mask drives scoring in Sing mode for that recording.

The main UI lives in `components/BirdKaraoke.jsx`; the home route simply renders it from `app/page.js`.

## Scoring

After you record, the app builds a **user mask** from your microphone spectrogram (frequency bins above a threshold, with light spatial spreading) and compares it to the **target mask** from the editor (`noteMask` in `data/birds.json`).

Two numbers drive the score (0–100):

1. **`targetCovered`** — Of all pixels in the target mask, what fraction did you also activate? Rewards landing energy on the annotated contour.
2. **`outsideRatio`** — Of all pixels in *your* mask, what fraction sit **outside** the target? Extra blobs away from the teacher pattern hurt; the score uses **`1 - outsideRatio`** so staying on-mask helps.

The final value is a weighted blend:

`score = 100 × (w_within × targetCovered + w_off × (1 − outsideRatio))` with **`w_within + w_off = 1`**.

After you choose **Sing**, the bird-picker step has a **Strictness** chip row to pick one of four presets (same logic in [`lib/scoring.js`](lib/scoring.js)). Each option’s `title` tooltip shows the **coverage : off-mask** ratio before normalization:

| Preset | Ratio (coverage : off-mask) | `w_within` | `w_off` |
| --- | --- | --- | --- |
| Gentle | 9 : 1 | 0.9 | 0.1 |
| Moderate | 8 : 2 | 0.8 | 0.2 |
| Firm | 7 : 3 | 0.7 | 0.3 |
| Strict | 6 : 4 | 0.6 | 0.4 |

Stricter presets put more weight on **`(1 − outsideRatio)`**, so stray energy off the mask lowers your score more. Your choice is stored in **`localStorage`**; per-bird “Best” scores are tracked **separately per preset** so you can compare apples to apples.

## Resources the app uses

| Resource | Role |
| --- | --- |
| **`data/birds.json`** | Catalog of birds: `id`, display `name`, `silhouette` path, and `recordings[]` with difficulty, optional local `path` to audio, optional Xeno-Canto-style `query`, attribution in `source`, and optional `noteMask` (run-length encoded mask used for scoring). Loaded at build time via `lib/birds.js`. |
| **`public/silhouette/*.svg`** | Bird silhouettes referenced by each bird’s `silhouette` field. |
| **`public/audio/...`** | WAV (or other) files for recordings that set `path` (e.g. `/audio/american-robin/american-robin.wav`). If a recording has no local file, the app may still show metadata and editor flows depending on configuration. |
| **Spectrogram (reference)** | Decoded from the reference recording in the browser: STFT-style frames with a custom FFT and a fixed colormap, drawn to canvas (`buildBirdSpectrogram`, `drawFullSpectrogram` in `BirdKaraoke.jsx`). |
| **Spectrogram (you)** | While recording, the Web Audio **AnalyserNode** supplies frequency bins that are painted live and accumulated into a mask for overlap scoring against the target mask. |
| **`POST /api/editor/mask`** | Saves an updated `noteMask` for a recording back into `data/birds.json` on disk (used from Editor mode in dev). |

Stack: **Next.js** (App Router), **React**, no extra runtime npm packages beyond the framework.

@author: FranckPrts