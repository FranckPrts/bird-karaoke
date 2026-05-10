"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import BirdSilhouette from "@/components/icons/BirdSilhouette";
import NestHomeIcon from "@/components/icons/NestHomeIcon";
import { BIRDS, DIFFICULTY_COLORS, getPrimaryLocalRecording, hasLocalRecording } from "@/lib/birds";
import {
  SCORING_DIFFICULTIES,
  DEFAULT_SCORING_DIFFICULTY_ID,
  bestScoreKey,
  getScoringDifficulty,
  scoreMaskOverlap as scoreMaskOverlapWithDifficulty,
} from "@/lib/scoring";

const MASK_WIDTH = 300;
const MASK_HEIGHT = 256;
const MASK_SIZE = MASK_WIDTH * MASK_HEIGHT;
const USER_BIN_THRESHOLD = 72;

const PLAYER_STEPS = {
  select: "Step 1 of 5: Select a bird",
  recordingSelect: "Step 2 of 5: Choose a recording",
  preview: "Step 3 of 5: Listen to the call",
  recording: "Step 4 of 5: Record your mimic",
  results: "Step 5 of 5: Review your score",
};

const SCORING_DIFFICULTY_STORAGE_KEY = "bird-karaoke-scoring-difficulty";

function fftMag(samples) {
  const n = samples.length;
  const re = new Float32Array(samples);
  const im = new Float32Array(n);
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      const wr = Math.cos(ang);
      const wi = -Math.sin(ang);
      for (let j = 0; j < len >> 1; j++) {
        const half = j + (len >> 1);
        const tr = cr * re[i + half] - ci * im[i + half];
        const ti = cr * im[i + half] + ci * re[i + half];
        re[i + half] = re[i + j] - tr;
        im[i + half] = im[i + j] - ti;
        re[i + j] += tr;
        im[i + j] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
  const scale = 2 / n;
  const mag = new Uint8Array(n >> 1);
  for (let i = 0; i < n >> 1; i++) {
    const m = Math.hypot(re[i], im[i]) * scale;
    const db = 20 * Math.log10(Math.max(1e-10, m));
    mag[i] = Math.min(255, Math.max(0, Math.round(((db + 100) / 70) * 255)));
  }
  return mag;
}

function buildBirdSpectrogram(audioBuf, cols = MASK_WIDTH) {
  const ch = audioBuf.getChannelData(0);
  const fftSize = 2048;
  const hop = Math.max(1, Math.floor(ch.length / cols));
  const frames = [];
  for (let c = 0; c < cols; c++) {
    const s = c * hop;
    const win = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      const samp = ch[s + i] || 0;
      win[i] = samp * 0.5 * (1 - Math.cos((2 * Math.PI * i) / fftSize));
    }
    frames.push(fftMag(win).slice(0, MASK_HEIGHT));
  }
  return frames;
}

const CLUT = (() => {
  const lut = new Uint8Array(256 * 3);
  for (let v = 0; v < 256; v++) {
    const t = v / 255;
    lut[v * 3] = Math.round(Math.min(255, t < 0.5 ? t * 2 * 200 : 200 + (t - 0.5) * 2 * 55));
    lut[v * 3 + 1] = Math.round(
      Math.min(255, t < 0.35 ? 0 : t < 0.7 ? ((t - 0.35) / 0.35) * 220 : 220 + ((t - 0.7) / 0.3) * 35),
    );
    lut[v * 3 + 2] = Math.round(
      Math.min(255, t < 0.15 ? (t / 0.15) * 190 : t < 0.45 ? (1 - (t - 0.15) / 0.3) * 190 : 0),
    );
  }
  return lut;
})();

function createEmptyMask() {
  return new Uint8Array(MASK_SIZE);
}

function parseDuration(len) {
  if (!len) return 4;
  if (typeof len === "string" && len.includes(":")) {
    const [m, s] = len.split(":").map(Number);
    return m * 60 + (s || 0);
  }
  return parseFloat(len) || 4;
}

function drawFullSpectrogram(canvasRef, frames) {
  const can = canvasRef.current;
  if (!can) return;
  const ctx = can.getContext("2d");
  const w = can.width;
  const h = can.height;
  ctx.clearRect(0, 0, w, h);
  if (!frames?.length) return;
  const img = ctx.createImageData(w, h);
  for (let x = 0; x < w; x++) {
    const frame = frames[Math.floor((x * frames.length) / w)] || new Uint8Array(MASK_HEIGHT);
    for (let y = 0; y < h; y++) {
      const bin = Math.min(Math.floor((1 - y / h) * frame.length), frame.length - 1);
      const v = frame[bin] || 0;
      const i = (y * w + x) * 4;
      img.data[i] = CLUT[v * 3];
      img.data[i + 1] = CLUT[v * 3 + 1];
      img.data[i + 2] = CLUT[v * 3 + 2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function drawLiveCol(canvasRef, slice, xFrac) {
  const can = canvasRef.current;
  if (!can) return;
  const ctx = can.getContext("2d");
  const w = can.width;
  const h = can.height;
  const x = Math.round(xFrac * w);
  const cw = Math.max(2, Math.ceil(w / MASK_WIDTH));
  const img = ctx.createImageData(cw, h);
  for (let y = 0; y < h; y++) {
    const bin = Math.min(Math.floor((1 - y / h) * slice.length), slice.length - 1);
    const v = slice[bin] || 0;
    for (let xi = 0; xi < cw; xi++) {
      const i = (y * cw + xi) * 4;
      img.data[i] = CLUT[v * 3];
      img.data[i + 1] = CLUT[v * 3 + 1];
      img.data[i + 2] = CLUT[v * 3 + 2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, x, 0);
}

function drawMaskCanvas(canvasRef, mask) {
  const can = canvasRef.current;
  if (!can) return;
  const ctx = can.getContext("2d");
  const w = can.width;
  const h = can.height;
  ctx.clearRect(0, 0, w, h);
  if (!mask) return;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < Math.min(mask.length, w * h); i++) {
    if (!mask[i]) continue;
    const px = i * 4;
    img.data[px] = 106;
    img.data[px + 1] = 222;
    img.data[px + 2] = 186;
    img.data[px + 3] = 188;
  }
  ctx.putImageData(img, 0, 0);
}

function drawMaskComparisonCanvas(overlayRef, targetMask, userMask) {
  const can = overlayRef.current;
  if (!can) return;
  const ctx = can.getContext("2d");
  const w = can.width;
  const h = can.height;
  ctx.fillStyle = "#0c0a09";
  ctx.fillRect(0, 0, w, h);
  if (!targetMask || !userMask) return;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    const isTarget = targetMask[i] > 0;
    const isUser = userMask[i] > 0;
    const px = i * 4;
    if (!isTarget && !isUser) {
      img.data[px + 3] = 18;
    } else if (isTarget && isUser) {
      img.data[px] = 166;
      img.data[px + 1] = 123;
      img.data[px + 2] = 249;
      img.data[px + 3] = 230;
    } else if (isTarget) {
      img.data[px] = 75;
      img.data[px + 1] = 206;
      img.data[px + 2] = 160;
      img.data[px + 3] = 205;
    } else {
      img.data[px] = 248;
      img.data[px + 1] = 114;
      img.data[px + 2] = 114;
      img.data[px + 3] = 205;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function buildUserMask(frames) {
  const mask = createEmptyMask();
  if (!frames.length) return mask;
  for (let x = 0; x < MASK_WIDTH; x++) {
    const frame = frames[Math.floor((x * frames.length) / MASK_WIDTH)] || new Uint8Array(MASK_HEIGHT);
    for (let y = 0; y < MASK_HEIGHT; y++) {
      const bin = Math.min(Math.floor((1 - y / MASK_HEIGHT) * frame.length), frame.length - 1);
      const active = (frame[bin] || 0) >= USER_BIN_THRESHOLD;
      if (!active) continue;
      const idx = y * MASK_WIDTH + x;
      mask[idx] = 1;
      if (x > 0) mask[idx - 1] = 1;
      if (x < MASK_WIDTH - 1) mask[idx + 1] = 1;
      if (y > 0) mask[idx - MASK_WIDTH] = 1;
      if (y < MASK_HEIGHT - 1) mask[idx + MASK_WIDTH] = 1;
    }
  }
  return mask;
}

function maskToRuns(mask) {
  const runs = [];
  let i = 0;
  while (i < mask.length) {
    if (!mask[i]) {
      i += 1;
      continue;
    }
    const start = i;
    while (i < mask.length && mask[i]) i += 1;
    runs.push(`${start}:${i - start}`);
  }
  return runs.join(";");
}

function runsToMask(serialized) {
  const mask = createEmptyMask();
  if (!serialized || typeof serialized !== "string") return mask;
  const runs = serialized.split(";");
  for (const run of runs) {
    if (!run) continue;
    const [startRaw, lenRaw] = run.split(":");
    const start = Number(startRaw);
    const len = Number(lenRaw);
    if (!Number.isFinite(start) || !Number.isFinite(len) || len <= 0) continue;
    const end = Math.min(mask.length, start + len);
    for (let i = Math.max(0, start); i < end; i++) mask[i] = 1;
  }
  return mask;
}

function getGrade(score) {
  if (score >= 90) return { label: "Master Birder", icon: "I", color: "#8f5b29" };
  if (score >= 75) return { label: "Skilled Warbler", icon: "II", color: "#6b5f4d" };
  if (score >= 60) return { label: "Apprentice Nester", icon: "III", color: "#7a5f33" };
  if (score >= 40) return { label: "Fledgling", icon: "IV", color: "#5f6a4f" };
  return { label: "Still in the Egg", icon: "V", color: "#7a746e" };
}

export default function BirdKaraoke() {
  const [catalog, setCatalog] = useState(BIRDS);
  const [mode, setMode] = useState("home");
  const [playerScreen, setPlayerScreen] = useState("select");
  const [editorScreen, setEditorScreen] = useState("birds");
  const [selectedBirdId, setSelectedBirdId] = useState(null);
  const [selectedRecordingId, setSelectedRecordingId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [duration, setDuration] = useState(4);
  const [playProg, setPlayProg] = useState(0);
  const [recProg, setRecProg] = useState(0);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [recPhase, setRecPhase] = useState("idle");
  const [score, setScore] = useState(null);
  const [bests, setBests] = useState({});
  const [scoringDifficultyId, setScoringDifficultyId] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_SCORING_DIFFICULTY_ID;
    try {
      const raw = localStorage.getItem(SCORING_DIFFICULTY_STORAGE_KEY);
      if (raw && SCORING_DIFFICULTIES.some((d) => d.id === raw)) return raw;
    } catch {
      /* ignore */
    }
    return DEFAULT_SCORING_DIFFICULTY_ID;
  });
  const [resultMaskData, setResultMaskData] = useState(null);
  const [isMicRequestInFlight, setIsMicRequestInFlight] = useState(false);
  const [brushSize, setBrushSize] = useState(10);
  const [isErasing, setIsErasing] = useState(false);
  const [editorMask, setEditorMask] = useState(() => createEmptyMask());
  const [isSavingMask, setIsSavingMask] = useState(false);
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [recordingAudioUrl, setRecordingAudioUrl] = useState(null);
  const [recordingInfoOpen, setRecordingInfoOpen] = useState(false);
  const [recordingTooltipBox, setRecordingTooltipBox] = useState(null);
  const recordingInfoWrapRef = useRef(null);
  const recordingTooltipRef = useRef(null);
  const [birdPhotoOpen, setBirdPhotoOpen] = useState(false);
  const [birdPhotoTooltipBox, setBirdPhotoTooltipBox] = useState(null);
  const birdPhotoWrapRef = useRef(null);
  const birdPhotoTooltipRef = useRef(null);

  const acRef = useRef(null);
  const birdBufRef = useRef(null);
  const birdFramesRef = useRef([]);
  const userFramesRef = useRef([]);
  const rafRef = useRef(null);
  const streamRef = useRef(null);
  const grantedStreamRef = useRef(null);
  const micRequestSeqRef = useRef(0);
  const playerBirdCanRef = useRef(null);
  const userCanRef = useRef(null);
  const resultOverlayRef = useRef(null);
  const manualStartRequestRef = useRef(false);
  const editorSpectroRef = useRef(null);
  const editorMaskRef = useRef(null);
  const isPaintingRef = useRef(false);
  const workingMaskRef = useRef(createEmptyMask());

  const selectedBird = useMemo(() => catalog.find((b) => b.id === selectedBirdId) || null, [catalog, selectedBirdId]);
  const availableBirds = useMemo(() => catalog.filter((bird) => hasLocalRecording(bird)), [catalog]);
  const selectedRecording = useMemo(
    () => selectedBird?.recordings?.find((r) => r.id === selectedRecordingId) || null,
    [selectedBird, selectedRecordingId],
  );
  const selectedBirdLocalRecordings = useMemo(
    () => (selectedBird?.recordings || []).filter((recording) => Boolean(recording.path)),
    [selectedBird],
  );
  const activeScoringDifficulty = useMemo(() => getScoringDifficulty(scoringDifficultyId), [scoringDifficultyId]);

  useLayoutEffect(() => {
    if (!recordingInfoOpen) return;
    const margin = 10;
    const updateBox = () => {
      const anchor = recordingInfoWrapRef.current;
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const width = Math.min(320, Math.max(200, window.innerWidth - margin * 2));
      let left = r.right - width;
      left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
      const top = r.bottom + margin;
      setRecordingTooltipBox({ top, left, width });
    };
    updateBox();
    window.addEventListener("resize", updateBox);
    window.addEventListener("scroll", updateBox, true);
    return () => {
      window.removeEventListener("resize", updateBox);
      window.removeEventListener("scroll", updateBox, true);
      setRecordingTooltipBox(null);
    };
  }, [recordingInfoOpen]);

  useLayoutEffect(() => {
    if (!birdPhotoOpen) return;
    const margin = 10;
    const updateBox = () => {
      const anchor = birdPhotoWrapRef.current;
      if (!anchor) return;
      const r = anchor.getBoundingClientRect();
      const width = Math.min(400, Math.max(280, window.innerWidth - margin * 2));
      let left = r.right - width;
      left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
      const top = r.bottom + margin;
      setBirdPhotoTooltipBox({ top, left, width });
    };
    updateBox();
    window.addEventListener("resize", updateBox);
    window.addEventListener("scroll", updateBox, true);
    return () => {
      window.removeEventListener("resize", updateBox);
      window.removeEventListener("scroll", updateBox, true);
      setBirdPhotoTooltipBox(null);
    };
  }, [birdPhotoOpen]);

  useEffect(() => {
    if (!recordingInfoOpen && !birdPhotoOpen) return;
    const onPointerDown = (event) => {
      const t = event.target;
      if (recordingInfoWrapRef.current?.contains(t) || recordingTooltipRef.current?.contains(t)) return;
      if (birdPhotoWrapRef.current?.contains(t) || birdPhotoTooltipRef.current?.contains(t)) return;
      setRecordingInfoOpen(false);
      setBirdPhotoOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        setRecordingInfoOpen(false);
        setBirdPhotoOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [recordingInfoOpen, birdPhotoOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(SCORING_DIFFICULTY_STORAGE_KEY, scoringDifficultyId);
    } catch {
      /* ignore */
    }
  }, [scoringDifficultyId]);

  const getAC = () => {
    if (!acRef.current || acRef.current.state === "closed") {
      acRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    return acRef.current;
  };

  const resetPlayerState = () => {
    setScore(null);
    setPlayProg(0);
    setRecProg(0);
    setHasPlayed(false);
    setIsPlaying(false);
    setRecPhase("idle");
    setResultMaskData(null);
    manualStartRequestRef.current = false;
  };

  const loadRecording = useCallback(
    async (bird, recording) => {
      setLoading(true);
      setError(null);
      setRecordingAudioUrl(null);
      try {
        const ac = getAC();
        if (ac.state === "suspended") await ac.resume();
        let url = recording.path || null;
        let dur = 4;
        if (!url) {
          const q = encodeURIComponent(recording.query || "");
          const res = await fetch(`https://xeno-canto.org/api/2/recordings?query=${q}`);
          if (!res.ok) throw new Error("xeno-canto API error.");
          const data = await res.json();
          if (!data.recordings?.length) throw new Error(`No recordings found for ${bird.name}.`);
          url = data.recordings[0].file;
          if (url.startsWith("//")) url = `https:${url}`;
          else if (url.startsWith("http:")) url = `https:${url.slice(5)}`;
          dur = Math.min(parseDuration(data.recordings[0].length), 8);
        }
        const audioRes = await fetch(url);
        if (!audioRes.ok) throw new Error("Failed to load audio file.");
        const arrayBuf = await audioRes.arrayBuffer();
        const audioBuf = await ac.decodeAudioData(arrayBuf);
        if (recording.path) dur = Math.min(audioBuf.duration || 4, 8);
        birdBufRef.current = audioBuf;
        birdFramesRef.current = buildBirdSpectrogram(audioBuf);
        userFramesRef.current = [];
        setDuration(dur);
        let absoluteUrl = url;
        if (typeof window !== "undefined" && url) {
          try {
            absoluteUrl = new URL(url, window.location.origin).href;
          } catch {
            /* keep url */
          }
        }
        setRecordingAudioUrl(absoluteUrl || null);
        return true;
      } catch (e) {
        setError(e.message || "Could not load recording.");
        setRecordingAudioUrl(null);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.shiftKey && event.key.toLowerCase() === "e") {
        event.preventDefault();
        setMode("editor");
        setEditorScreen("birds");
        setError(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (mode !== "player" || playerScreen !== "preview") return;
    drawFullSpectrogram(playerBirdCanRef, birdFramesRef.current);
  }, [mode, playerScreen, selectedRecordingId]);

  useEffect(() => {
    if (mode !== "editor" || editorScreen !== "edit") return;
    drawFullSpectrogram(editorSpectroRef, birdFramesRef.current);
  }, [mode, editorScreen, selectedRecording?.id]);

  useEffect(() => {
    if (mode !== "editor" || editorScreen !== "edit") return;
    drawMaskCanvas(editorMaskRef, editorMask);
  }, [mode, editorScreen, editorMask]);

  useEffect(() => {
    if (mode === "player" && playerScreen === "results" && resultMaskData) {
      drawMaskComparisonCanvas(resultOverlayRef, resultMaskData.targetMask, resultMaskData.userMask);
    }
  }, [mode, playerScreen, resultMaskData]);

  const beginPlayer = () => {
    setMode("player");
    setPlayerScreen("select");
    setSelectedBirdId(null);
    setSelectedRecordingId(null);
    setRecordingInfoOpen(false);
    setBirdPhotoOpen(false);
    setError(null);
    resetPlayerState();
  };

  const choosePlayerBird = async (bird) => {
    const localRecordings = (bird.recordings || []).filter((recording) => Boolean(recording.path));
    if (!localRecordings.length) {
      setError("No recording found for this bird.");
      return;
    }
    setSelectedBirdId(bird.id);
    setSelectedRecordingId(null);
    setRecordingInfoOpen(false);
    setBirdPhotoOpen(false);
    resetPlayerState();
    if (localRecordings.length > 1) {
      setPlayerScreen("recordingSelect");
      return;
    }
    const [recording] = localRecordings;
    const ok = await loadRecording(bird, recording);
    if (!ok) return;
    setSelectedRecordingId(recording.id);
    setPlayerScreen("preview");
  };

  const choosePlayerRecording = async (recording) => {
    if (!selectedBird) return;
    const ok = await loadRecording(selectedBird, recording);
    if (!ok) return;
    setSelectedRecordingId(recording.id);
    setRecordingInfoOpen(false);
    setBirdPhotoOpen(false);
    resetPlayerState();
    setPlayerScreen("preview");
  };

  const playBird = useCallback(async () => {
    if (!birdBufRef.current || isPlaying) return;
    setIsPlaying(true);
    setPlayProg(0);
    const ac = getAC();
    if (ac.state === "suspended") await ac.resume();
    drawFullSpectrogram(playerBirdCanRef, birdFramesRef.current);
    const src = ac.createBufferSource();
    src.buffer = birdBufRef.current;
    src.connect(ac.destination);
    const dur = birdBufRef.current.duration;
    const t0 = ac.currentTime;
    src.start();
    src.onended = () => {
      setIsPlaying(false);
      setHasPlayed(true);
      setPlayProg(1);
    };
    const animate = () => {
      const elapsed = ac.currentTime - t0;
      if (elapsed > dur + 0.2) return;
      const frac = Math.min(1, elapsed / dur);
      setPlayProg(frac);
      const fi = Math.floor(frac * (birdFramesRef.current.length - 1));
      const frame = birdFramesRef.current[fi];
      if (frame) drawLiveCol(playerBirdCanRef, frame, frac);
      rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
  }, [isPlaying]);

  const startRecording = useCallback(async () => {
    if (isMicRequestInFlight) return;
    const reqId = ++micRequestSeqRef.current;
    setIsMicRequestInFlight(true);
    setError(null);
    if (!navigator?.mediaDevices?.getUserMedia) {
      setError("This browser does not support microphone capture.");
      setIsMicRequestInFlight(false);
      return;
    }
    try {
      if (navigator.permissions?.query) {
        const micPerm = await navigator.permissions.query({ name: "microphone" });
        if (micPerm.state === "denied") {
          setError(`Microphone is blocked for this origin (${window.location.origin}). Reset site microphone permission to Ask/Allow, then retry Start Recording.`);
          setIsMicRequestInFlight(false);
          return;
        }
      }
    } catch {}
    let hardTimeoutTimer = null;
    try {
      const gumPromise = navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const timeoutPromise = new Promise((_, reject) => {
        hardTimeoutTimer = window.setTimeout(() => {
          reject(new Error("GUM_REQUEST_TIMEOUT"));
        }, 10000);
      });
      const stream = await Promise.race([gumPromise, timeoutPromise]);
      if (reqId !== micRequestSeqRef.current) {
        stream?.getTracks?.().forEach((t) => t.stop());
        return;
      }
      if (hardTimeoutTimer) {
        window.clearTimeout(hardTimeoutTimer);
        hardTimeoutTimer = null;
      }
      grantedStreamRef.current = stream;
      manualStartRequestRef.current = false;
      setRecordingInfoOpen(false);
      setBirdPhotoOpen(false);
      setPlayerScreen("recording");
    } catch (err) {
      if (hardTimeoutTimer) window.clearTimeout(hardTimeoutTimer);
      const isTimeout = err?.message === "GUM_REQUEST_TIMEOUT";
      let micError = "Microphone access failed. Please allow mic and retry.";
      if (isTimeout) micError = "Microphone request timed out in this browser. In Arc, verify site microphone permission and macOS microphone access for Arc, then retry.";
      else if (err?.name === "NotAllowedError") micError = "Microphone permission blocked. Allow microphone access in your browser and system settings, then retry.";
      else if (err?.name === "NotFoundError") micError = "No microphone was detected on this device.";
      else if (err?.name === "NotReadableError") micError = "Microphone is busy in another app. Close other apps using the mic and retry.";
      setError(micError);
    } finally {
      setIsMicRequestInFlight(false);
    }
  }, [isMicRequestInFlight]);

  const requestManualStart = useCallback(() => {
    if (recPhase !== "listening") return;
    manualStartRequestRef.current = true;
  }, [recPhase]);

  useEffect(() => {
    if (mode !== "player" || playerScreen !== "recording") return;
    let stopped = false;
    (async () => {
      const ac = getAC();
      if (ac.state === "suspended") await ac.resume();
      setRecPhase("listening");
      setRecProg(0);
      let stream;
      try {
        stream = grantedStreamRef.current || (await navigator.mediaDevices.getUserMedia({ audio: true, video: false }));
        grantedStreamRef.current = null;
      } catch (err) {
        let micError = "Microphone access failed. Please allow mic and retry.";
        if (err?.name === "NotAllowedError") micError = "Microphone permission blocked. Allow microphone access in your browser and system settings, then retry.";
        else if (err?.name === "NotFoundError") micError = "No microphone was detected on this device.";
        else if (err?.name === "NotReadableError") micError = "Microphone is busy in another app. Close other apps using the mic and retry.";
        setError(micError);
        setPlayerScreen("preview");
        return;
      }
      if (stopped) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const micSrc = ac.createMediaStreamSource(stream);
      const analyser = ac.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.1;
      analyser.minDecibels = -100;
      analyser.maxDecibels = -30;
      micSrc.connect(analyser);
      const fft = new Uint8Array(analyser.frequencyBinCount);
      const td = new Float32Array(analyser.fftSize);
      userFramesRef.current = [];
      userCanRef.current?.getContext("2d").clearRect(0, 0, MASK_WIDTH, MASK_HEIGHT);
      const localDur = birdBufRef.current?.duration || 4;
      let started = false;
      let t0 = null;
      const preRollFrames = [];
      const beginCapture = (now) => {
        started = true;
        const seededFrames = preRollFrames.slice(0, -1).map((f) => new Uint8Array(f.slice));
        userFramesRef.current = seededFrames;
        t0 = seededFrames.length ? preRollFrames[0].t : now;
        manualStartRequestRef.current = false;
        setRecPhase("recording");
      };
      const frame = () => {
        if (stopped) return;
        analyser.getByteFrequencyData(fft);
        analyser.getFloatTimeDomainData(td);
        const rms = Math.sqrt(td.reduce((sum, v) => sum + v * v, 0) / td.length);
        const now = ac.currentTime;
        const slice = fft.slice(0, MASK_HEIGHT);
        if (!started) {
          preRollFrames.push({ t: now, slice: new Uint8Array(slice) });
          if (preRollFrames.length > 10) preRollFrames.shift();
        }
        const manualRequested = manualStartRequestRef.current;
        if (!started && (rms > 0.012 || manualRequested)) {
          beginCapture(now);
        }
        if (started) {
          const elapsed = now - t0;
          userFramesRef.current.push(new Uint8Array(slice));
          setRecProg(Math.min(1, elapsed / localDur));
          drawLiveCol(userCanRef, slice, elapsed / localDur);
          if (elapsed >= localDur) {
            stream.getTracks().forEach((t) => t.stop());
            if (!stopped) {
              const targetMask = runsToMask(selectedRecording?.noteMask);
              const userMask = buildUserMask(userFramesRef.current);
              const scoring = scoreMaskOverlapWithDifficulty(targetMask, userMask, scoringDifficultyId);
              setScore(scoring.score);
              setResultMaskData({
                targetMask,
                userMask,
                hasTarget: scoring.hasTarget,
                breakdown: scoring.breakdown,
              });
              if (selectedBird) {
                const key = bestScoreKey(selectedBird.id, scoringDifficultyId);
                setBests((prev) => ({ ...prev, [key]: Math.max(prev[key] || 0, scoring.score) }));
              }
              setPlayerScreen("results");
            }
            return;
          }
        }
        rafRef.current = requestAnimationFrame(frame);
      };
      rafRef.current = requestAnimationFrame(frame);
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(rafRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, [mode, playerScreen, selectedBird, selectedRecording, scoringDifficultyId]);

  const beginRecognize = () => {
    setMode("recognize");
    setError(null);
  };

  const goHome = () => {
    setMode("home");
  };

  const chooseEditorBird = (bird) => {
    setSelectedBirdId(bird.id);
    setEditorScreen("recordings");
    setError(null);
  };

  const chooseEditorRecording = async (recording) => {
    if (!selectedBird) return;
    const ok = await loadRecording(selectedBird, recording);
    if (!ok) return;
    const loadedMask = runsToMask(recording.noteMask);
    setEditorMask(loadedMask);
    workingMaskRef.current = Uint8Array.from(loadedMask);
    setSelectedRecordingId(recording.id);
    setRecordingInfoOpen(false);
    setBirdPhotoOpen(false);
    setEditorScreen("edit");
  };

  const paintAtEvent = (event) => {
    const canvas = editorMaskRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * MASK_WIDTH;
    const py = ((event.clientY - rect.top) / rect.height) * MASK_HEIGHT;
    const radius = Math.max(1, brushSize);
    const mask = workingMaskRef.current;
    const minX = Math.max(0, Math.floor(px - radius));
    const maxX = Math.min(MASK_WIDTH - 1, Math.ceil(px + radius));
    const minY = Math.max(0, Math.floor(py - radius));
    const maxY = Math.min(MASK_HEIGHT - 1, Math.ceil(py + radius));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x - px;
        const dy = y - py;
        if (dx * dx + dy * dy > radius * radius) continue;
        mask[y * MASK_WIDTH + x] = isErasing ? 0 : 1;
      }
    }
    drawMaskCanvas(editorMaskRef, mask);
  };

  const beginPaint = (event) => {
    if (mode !== "editor" || editorScreen !== "edit") return;
    isPaintingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    workingMaskRef.current = Uint8Array.from(editorMask);
    paintAtEvent(event);
  };

  const continuePaint = (event) => {
    if (!isPaintingRef.current) return;
    paintAtEvent(event);
  };

  const endPaint = (event) => {
    if (!isPaintingRef.current) return;
    isPaintingRef.current = false;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {}
    const committed = Uint8Array.from(workingMaskRef.current);
    setEditorMask(committed);
    workingMaskRef.current = committed;
  };

  const clearEditorMask = () => {
    const empty = createEmptyMask();
    setEditorMask(empty);
    workingMaskRef.current = Uint8Array.from(empty);
    drawMaskCanvas(editorMaskRef, empty);
  };

  const saveEditorMask = async () => {
    if (!selectedBird || !selectedRecording) return;
    setIsSavingMask(true);
    setError(null);
    try {
      const noteMask = maskToRuns(editorMask);
      const res = await fetch("/api/editor/mask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ birdId: selectedBird.id, recordingId: selectedRecording.id, noteMask }),
      });
      if (!res.ok) throw new Error("Could not save mask to birds.json.");
      setCatalog((prev) =>
        prev.map((bird) =>
          bird.id !== selectedBird.id
            ? bird
            : { ...bird, recordings: bird.recordings.map((r) => (r.id === selectedRecording.id ? { ...r, noteMask } : r)) },
        ),
      );
    } catch (e) {
      setError(e.message || "Could not save mask.");
    } finally {
      setIsSavingMask(false);
    }
  };

  const downloadEditorZip = async () => {
    if (!selectedBird || !selectedRecording) return;
    setIsExportingZip(true);
    setError(null);
    try {
      const noteMask = maskToRuns(editorMask);
      const res = await fetch("/api/editor/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ birdId: selectedBird.id, recordingId: selectedRecording.id, noteMask }),
      });
      if (!res.ok) {
        let message = "Could not export ZIP package.";
        try {
          const payload = await res.json();
          if (payload?.error) message = payload.error;
        } catch {
          /* ignore */
        }
        throw new Error(message);
      }

      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename="?([^"]+)"?/i);
      const filename = filenameMatch?.[1] || `${selectedBird.id}-${selectedRecording.id}.zip`;
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
    } catch (e) {
      setError(e.message || "Could not export ZIP package.");
    } finally {
      setIsExportingZip(false);
    }
  };

  const grade = score !== null ? getGrade(score) : null;
  const hasMaskForSelectedRecording = selectedRecording?.noteMask && selectedRecording.noteMask.length > 0;

  return (
    <main className="pageShell">
      <section className="appPanel">
        <header className="appHeader">
          <div className="headerLead">
            <div className="headerMark">
              <BirdSilhouette src="flying" className="headerBird" />
            </div>
            <div className="headerTitles">
              <h1>Bird Karaoke</h1>
              <p>Train your ear. Mimic the call. Compare the shape.</p>
            </div>
          </div>
          <button
            type="button"
            className="headerNestHome"
            onClick={goHome}
            disabled={mode === "home"}
            aria-label="Home"
            title="Home"
          >
            <NestHomeIcon className="headerNestIcon" />
            <span className="headerNestHomeText">Home</span>
          </button>
        </header>

        {mode === "home" && (
          <section className="contentPanel">
            <h2>Choose a play mode</h2>
            <p className="muted">Sing mimics calls, while Recognize will identify what you are hearing.</p>
            <div className="birdGrid modeGrid">
              <button className="birdCard modeCard" onClick={beginPlayer}>
                <BirdSilhouette src="flying" className="birdIcon" />
                <div className="birdCardMeta">
                  <div className="birdName">Sing</div>
                  <div className="bestText">Pick a bird call and mimic its contour.</div>
                </div>
              </button>
              <button className="birdCard modeCard" onClick={beginRecognize}>
                <BirdSilhouette src="sitting" className="birdIcon" />
                <div className="birdCardMeta">
                  <div className="birdName">Recognize</div>
                  <div className="bestText">Identify calls from recordings. Coming soon.</div>
                </div>
              </button>
            </div>
          </section>
        )}

        {mode === "recognize" && (
          <section className="contentPanel">
            <h2>Recognize mode</h2>
            <p className="muted">This mode is coming soon. For now, use Sing to practice with available local recordings.</p>
            <div className="backChipRow">
              <button type="button" className="chipBtn" onClick={() => setMode("home")}>
                Back
              </button>
            </div>
          </section>
        )}

        {mode === "player" && (
          <>
            <div className="stepRow">{PLAYER_STEPS[playerScreen]}</div>

            {playerScreen === "select" && (
              <section className="contentPanel">
                <h2>Choose a bird call</h2>
                <div className="scoringChipsRow" role="group" aria-label="Scoring strictness">
                  <span className="scoringChipsLead">Strictness</span>
                  {SCORING_DIFFICULTIES.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      title={`${d.ratioLabel} on-mask : off-mask`}
                      className={`chipBtn scoringChip ${scoringDifficultyId === d.id ? "scoringChipActive" : ""}`}
                      onClick={() => setScoringDifficultyId(d.id)}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
                <div className="birdGrid">
                  {availableBirds.map((item) => {
                    const bestKey = bestScoreKey(item.id, scoringDifficultyId);
                    const bestVal = bests[bestKey];
                    return (
                      <button key={item.id} className="birdCard" disabled={loading} onClick={() => choosePlayerBird(item)}>
                        <BirdSilhouette src={item.silhouette} className="birdIcon" />
                        <div className="birdCardMeta">
                          <div className="birdName">{item.name}</div>
                          <div className="birdSubRow">
                            {(() => {
                              const rec = getPrimaryLocalRecording(item);
                              const diff = rec?.difficulty || "Medium";
                              const color = DIFFICULTY_COLORS[diff] || DIFFICULTY_COLORS.Medium;
                              return (
                                <span className="difficultyBadge" style={{ color, borderColor: `${color}55`, background: `${color}18` }}>
                                  {diff}
                                </span>
                              );
                            })()}
                            <span className="bestText">{bestVal != null ? `Best ${bestVal} pts` : "No score yet"}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="backChipRow">
                  <button type="button" className="chipBtn" onClick={() => setMode("home")}>
                    Back
                  </button>
                </div>
                {loading && <div className="notice">Loading recording...</div>}
                {error && <div className="notice error">{error}</div>}
              </section>
            )}

            {playerScreen === "recordingSelect" && selectedBird && (
              <section className="contentPanel">
                <h2>Choose a recording</h2>
                <p className="muted">Select which version of {selectedBird.name} you want to practice with.</p>
                <div className="birdGrid">
                  {selectedBirdLocalRecordings.map((recording, idx) => {
                    const color = DIFFICULTY_COLORS[recording.difficulty] || DIFFICULTY_COLORS.Medium;
                    return (
                      <button
                        key={recording.id}
                        className="birdCard"
                        disabled={loading}
                        onClick={() => choosePlayerRecording(recording)}
                      >
                        <BirdSilhouette src={selectedBird.silhouette} className="birdIcon" />
                        <div className="birdCardMeta">
                          <div className="birdName">Recording {idx + 1}</div>
                          <div className="birdSubRow">
                            <span className="difficultyBadge" style={{ color, borderColor: `${color}55`, background: `${color}18` }}>
                              {recording.difficulty}
                            </span>
                            <span className="bestText">{recording.source.provider || "Unknown source"}</span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div className="backChipRow">
                  <button type="button" className="chipBtn" onClick={() => setPlayerScreen("select")}>
                    Back to bird list
                  </button>
                </div>
                {loading && <div className="notice">Loading recording...</div>}
                {error && <div className="notice error">{error}</div>}
              </section>
            )}

            {playerScreen === "preview" && selectedBird && selectedRecording && (
              <section className="contentPanel">
                <div className="heroRow heroRowSplit">
                  <BirdSilhouette src={selectedBird.silhouette} className="heroBird" />
                  <div className="heroRowText">
                    <div className="heroRowTop">
                      <div>
                        <h2>{selectedBird.name}</h2>
                        <p className="muted">{duration.toFixed(1)} second reference recording</p>
                      </div>
                      <div className="heroMetaBtns">
                        <div className="recordingInfoAnchor" ref={recordingInfoWrapRef}>
                          <button
                            type="button"
                            className="heroInfoBtn"
                            aria-expanded={recordingInfoOpen}
                            aria-haspopup="dialog"
                            onClick={() =>
                              setRecordingInfoOpen((o) => {
                                const next = !o;
                                if (next) setBirdPhotoOpen(false);
                                return next;
                              })
                            }
                          >
                            {recordingInfoOpen ? "Close" : "Details"}
                          </button>
                        </div>
                        {selectedBird.photo ? (
                          <div className="recordingInfoAnchor" ref={birdPhotoWrapRef}>
                            <button
                              type="button"
                              className="heroInfoBtn"
                              aria-expanded={birdPhotoOpen}
                              aria-haspopup="dialog"
                              onClick={() =>
                                setBirdPhotoOpen((o) => {
                                  const next = !o;
                                  if (next) setRecordingInfoOpen(false);
                                  return next;
                                })
                              }
                            >
                              {birdPhotoOpen ? "Close photo" : "Photo"}
                            </button>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="spectrogramWrap">
                  <canvas ref={playerBirdCanRef} width={MASK_WIDTH} height={MASK_HEIGHT} style={{ width: "100%", height: "100%" }} />
                  {!hasPlayed && !isPlaying && <div className="spectroHint">Press play to inspect the call pattern</div>}
                </div>
                <div className="progressBar">
                  <div className="progressFill" style={{ width: `${playProg * 100}%` }} />
                </div>
                {!hasMaskForSelectedRecording && (
                  <div className="notice">This call has no saved note mask yet. Ask an editor to annotate it first.</div>
                )}
                <div className="actionRow">
                  <button className="btn secondary" onClick={playBird} disabled={isPlaying}>
                    {isPlaying ? "Playing..." : hasPlayed ? "Play Again" : "Play Bird Call"}
                  </button>
                  <button className="btn primary" onClick={startRecording} disabled={!hasPlayed || !hasMaskForSelectedRecording || isMicRequestInFlight}>
                    {isMicRequestInFlight ? "Requesting Mic..." : "Start Recording"}
                  </button>
                </div>
                <div className="backChipRow">
                  <button
                    type="button"
                    className="chipBtn"
                    onClick={() => {
                      setRecordingInfoOpen(false);
                      setBirdPhotoOpen(false);
                      setPlayerScreen(selectedBirdLocalRecordings.length > 1 ? "recordingSelect" : "select");
                    }}
                  >
                    {selectedBirdLocalRecordings.length > 1 ? "Back to recordings" : "Back to bird list"}
                  </button>
                </div>
                {recordingInfoOpen &&
                  recordingTooltipBox &&
                  typeof document !== "undefined" &&
                  createPortal(
                    <div
                      ref={recordingTooltipRef}
                      className="recordingInfoTooltip"
                      role="dialog"
                      aria-label="Recording details"
                      style={{
                        position: "fixed",
                        top: recordingTooltipBox.top,
                        left: recordingTooltipBox.left,
                        width: recordingTooltipBox.width,
                        zIndex: 4000,
                      }}
                    >
                      <div className="recordingInfoTooltipBody">
                        <p className="recordingInfoTooltipTitle">{selectedBird.name}</p>
                        <p className="muted recordingInfoTooltipMeta">
                          About {duration.toFixed(1)} s reference audio
                          {recordingAudioUrl ? "." : " (file URL unavailable)."}
                        </p>
                        {selectedRecording.source.recordist && (
                          <p>
                            <span className="recordingInfoTooltipLabel">Recordist</span> {selectedRecording.source.recordist}
                          </p>
                        )}
                        {selectedRecording.source.location && (
                          <p>
                            <span className="recordingInfoTooltipLabel">Location</span> {selectedRecording.source.location}
                          </p>
                        )}
                        {selectedRecording.source.license && (
                          <p>
                            <span className="recordingInfoTooltipLabel">License</span> {selectedRecording.source.license}
                          </p>
                        )}
                        {selectedRecording.source.capturedAt && (
                          <p>
                            <span className="recordingInfoTooltipLabel">Captured</span> {selectedRecording.source.capturedAt}
                          </p>
                        )}
                        {selectedRecording.source.xenoCantoId != null &&
                          String(selectedRecording.source.xenoCantoId).length > 0 && (
                            <p>
                              <span className="recordingInfoTooltipLabel">xeno-canto ID</span> {selectedRecording.source.xenoCantoId}
                            </p>
                          )}
                        {selectedRecording.query && (
                          <p className="recordingInfoMono recordingInfoTooltipQuery">{selectedRecording.query}</p>
                        )}
                      </div>
                      {selectedRecording.source.url ? (
                        <a
                          className="btn primary recordingInfoTooltipCta"
                          href={selectedRecording.source.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open source link
                        </a>
                      ) : (
                        <p className="muted recordingInfoTooltipNoLink">No catalog URL in source metadata.</p>
                      )}
                    </div>,
                    document.body,
                  )}
                {birdPhotoOpen &&
                  birdPhotoTooltipBox &&
                  selectedBird.photo &&
                  typeof document !== "undefined" &&
                  createPortal(
                    <div
                      ref={birdPhotoTooltipRef}
                      className="recordingInfoTooltip birdPhotoTooltip"
                      role="dialog"
                      aria-label={`${selectedBird.name} reference photo`}
                      style={{
                        position: "fixed",
                        top: birdPhotoTooltipBox.top,
                        left: birdPhotoTooltipBox.left,
                        width: birdPhotoTooltipBox.width,
                        zIndex: 4000,
                      }}
                    >
                      <div className="recordingInfoTooltipBody birdPhotoTooltipBody">
                        <p className="recordingInfoTooltipTitle">{selectedBird.name}</p>
                        <div className="recordingInfoTooltipPhotoWrap">
                          {/* eslint-disable-next-line @next/next/no-img-element -- local static JPEGs from Bootcamp PDF */}
                          <img
                            src={selectedBird.photo}
                            alt=""
                            className="recordingInfoTooltipPhoto birdPhotoTooltipImg"
                            width={360}
                            height={225}
                          />
                          <p className="recordingInfoTooltipPhotoCredit muted">
                            Credit{" "}
                            <a
                              href="https://docs.google.com/presentation/d/1ZeZou4qPEXtRB6A01rx-dHtW2z6fzEZelEPBwjhsxXc/edit?slide=id.p#slide=id.p"
                              target="_blank"
                              rel="noopener noreferrer"
                              className="muted"
                              style={{ fontSize: "0.72rem", textDecoration: "underline" }}
                            >
                              course handout
                            </a>
                            .
                          </p>
                        </div>
                      </div>
                    </div>,
                    document.body,
                  )}
              </section>
            )}

            {playerScreen === "recording" && selectedBird && (
              <section className="contentPanel">
                <div className="heroRow">
                  <BirdSilhouette src={selectedBird.silhouette} className="heroBird" />
                  <div>
                    <h2>{selectedBird.name}</h2>
                    <p className="muted">Recording window: {duration.toFixed(1)} seconds</p>
                  </div>
                </div>
                <div className="statusPill">
                  {recPhase === "idle" && "Initializing microphone..."}
                  {recPhase === "listening" && "Listening for your first note..."}
                  {recPhase === "recording" && "Recording now..."}
                </div>
                {recPhase === "listening" && (
                  <div className="actionRow">
                    <button type="button" className="btn primary" onClick={requestManualStart}>
                      Start Now
                    </button>
                  </div>
                )}
                <div className="spectrogramWrap">
                  <canvas ref={userCanRef} width={MASK_WIDTH} height={MASK_HEIGHT} style={{ width: "100%", height: "100%" }} />
                </div>
                <div className="progressBar">
                  <div className="progressFill live" style={{ width: `${recProg * 100}%` }} />
                </div>
              </section>
            )}

            {playerScreen === "results" && grade && selectedBird && (
              <section className="contentPanel">
                {!resultMaskData?.hasTarget && <div className="notice error">No saved target mask found for this recording.</div>}
                <div className="scorePanel">
                  <div className="scoreValue" style={{ color: grade.color }}>
                    {score}
                  </div>
                  <div className="scoreLabel">{grade.label}</div>
                  <p className="muted scoreDifficultyNote">
                    {activeScoringDifficulty.label} scoring ({activeScoringDifficulty.ratioLabel} coverage : off-mask)
                  </p>
                </div>
                {resultMaskData?.hasTarget && resultMaskData.breakdown && (
                  <div className="scoreBreakdown">
                    <table className="scoreBreakdownTable">
                      <tbody>
                        <tr>
                          <th scope="row">Matched target cells</th>
                          <td>
                            {resultMaskData.breakdown.intersection.toLocaleString()} of{" "}
                            {resultMaskData.breakdown.targetPixels.toLocaleString()}
                          </td>
                        </tr>
                        <tr>
                          <th scope="row">Your cells outside the target</th>
                          <td>
                            {resultMaskData.breakdown.userPixels === 0
                              ? "0 (nothing detected)"
                              : resultMaskData.breakdown.outsidePixels.toLocaleString()}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                    <div className="scoreBreakdownMathRow">
                      <div className="scoreBreakdownStrategyChip">
                        Scoring: {activeScoringDifficulty.ratioLabel}
                      </div>
                      <p className="muted scoreBreakdownMath">
                      100 × (
                      <span className="scoreBreakdownPolicyWeight">{activeScoringDifficulty.wWithin}</span> ×{" "}
                      {resultMaskData.breakdown.intersection.toLocaleString()}/
                      {resultMaskData.breakdown.targetPixels.toLocaleString()} +{" "}
                      <span className="scoreBreakdownPolicyWeight">{activeScoringDifficulty.wOff}</span> ×{" "}
                      {resultMaskData.breakdown.userPixels === 0 ? (
                        <>0</>
                      ) : (
                        <>
                          (1 − {resultMaskData.breakdown.outsidePixels.toLocaleString()}/
                          {resultMaskData.breakdown.userPixels.toLocaleString()})
                        </>
                      )}
                      ) = {(resultMaskData.breakdown.coveragePoints + resultMaskData.breakdown.offMaskPoints).toFixed(1)}{" "}
                      → {score}
                      </p>
                    </div>
                  </div>
                )}
                <div className="legend">
                  <span>Teal: target notes</span>
                  <span>Red: your voice blobs</span>
                  <span>Purple: overlap</span>
                </div>
                <div className="spectrogramWrap tall">
                  <canvas ref={resultOverlayRef} width={MASK_WIDTH} height={MASK_HEIGHT} style={{ width: "100%", height: "100%" }} />
                </div>
                <div className="actionRow">
                  <button className="btn secondary" onClick={() => setPlayerScreen("recording")}>
                    Try Again
                  </button>
                  <button className="btn primary" onClick={() => setPlayerScreen("select")}>
                    Choose Another Bird
                  </button>
                </div>
              </section>
            )}
          </>
        )}

        {mode === "editor" && (
          <>
            <div className="stepRow">Editor Mode</div>
            {editorScreen === "birds" && (
              <section className="contentPanel">
                <h2>Select a bird to annotate</h2>
                <div className="birdGrid">
                  {availableBirds.map((item) => (
                    <button key={item.id} className="birdCard" onClick={() => chooseEditorBird(item)}>
                      <BirdSilhouette src={item.silhouette} className="birdIcon" />
                      <div className="birdName">{item.name}</div>
                    </button>
                  ))}
                </div>
                <div className="backChipRow">
                  <button type="button" className="chipBtn" onClick={() => setMode("home")}>
                    Exit editor
                  </button>
                </div>
              </section>
            )}

            {editorScreen === "recordings" && selectedBird && (
              <section className="contentPanel">
                <h2>{selectedBird.name}: choose a recording</h2>
                <div className="birdGrid">
                  {selectedBirdLocalRecordings.map((recording) => (
                    <button key={recording.id} className="birdCard" disabled={loading} onClick={() => chooseEditorRecording(recording)}>
                      <div className="birdName">{recording.id}</div>
                      <div className="bestText">{recording.noteMask ? "Annotated" : "No mask yet"}</div>
                    </button>
                  ))}
                </div>
                <div className="backChipRow">
                  <button type="button" className="chipBtn" onClick={() => setEditorScreen("birds")}>
                    Back
                  </button>
                </div>
                {loading && <div className="notice">Loading recording...</div>}
                {error && <div className="notice error">{error}</div>}
              </section>
            )}

            {editorScreen === "edit" && selectedBird && selectedRecording && (
              <section className="contentPanel">
                <div className="heroRow">
                  <BirdSilhouette src={selectedBird.silhouette} className="heroBird" />
                  <div>
                    <h2>{selectedBird.name}</h2>
                    <p className="muted">{selectedRecording.id}</p>
                  </div>
                </div>
                <div className="noteTools">
                  <label className="brushControl">
                    Brush
                    <input type="range" min={3} max={24} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} />
                    <span>{brushSize}px</span>
                  </label>
                  <button className="btn secondary noteToolBtn" onClick={() => setIsErasing((v) => !v)}>
                    {isErasing ? "Erasing" : "Drawing"}
                  </button>
                  <button className="btn secondary noteToolBtn" onClick={clearEditorMask}>
                    Clear
                  </button>
                  <button className="btn primary noteToolBtn" onClick={saveEditorMask} disabled={isSavingMask}>
                    {isSavingMask ? "Saving..." : "Save"}
                  </button>
                  <button className="btn secondary noteToolBtn" onClick={downloadEditorZip} disabled={isExportingZip}>
                    {isExportingZip ? "Preparing ZIP..." : "Download ZIP"}
                  </button>
                </div>
                <div className="spectrogramWrap editorWrap">
                  <canvas ref={editorSpectroRef} width={MASK_WIDTH} height={MASK_HEIGHT} style={{ width: "100%", height: "100%" }} />
                  <canvas
                    ref={editorMaskRef}
                    width={MASK_WIDTH}
                    height={MASK_HEIGHT}
                    className="noteMaskLayer editable"
                    onPointerDown={beginPaint}
                    onPointerMove={continuePaint}
                    onPointerUp={endPaint}
                    onPointerCancel={endPaint}
                    onPointerLeave={endPaint}
                  />
                </div>
                {error && <div className="notice error">{error}</div>}
                <div className="actionRow">
                  <button className="btn secondary" onClick={() => setEditorScreen("recordings")}>
                    Back to recordings
                  </button>
                  <button className="btn secondary" onClick={() => setMode("home")}>
                    Exit editor
                  </button>
                </div>
              </section>
            )}
          </>
        )}
      </section>
      <footer className="appFooter">
        Made with love for the Bird Watching Club at Weill Cornell Medicine New York.{" "}
        <span className="footerHint">Shortcuts: Shift+E opens editor.</span>
        {/* <span className="footerHint">@franckPorteous</span> */}
      </footer>
    </main>
  );
}
