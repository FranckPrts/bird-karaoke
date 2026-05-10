export const DIFFICULTY_COLORS = {
  Easy: "#6f8a63",
  Medium: "#9b7b45",
  Hard: "#8f5a48",
};

import birdsData from "@/data/birds.json";

function normalizeDifficulty(difficulty) {
  if (!difficulty || typeof difficulty !== "string") return "Medium";
  const value = difficulty.trim().toLowerCase();
  if (value === "easy") return "Easy";
  if (value === "hard") return "Hard";
  return "Medium";
}

function normalizeRecording(recording, idx = 0, birdId = "bird") {
  return {
    id: recording.id || `${birdId}-recording-${idx + 1}`,
    difficulty: normalizeDifficulty(recording.difficulty),
    path: recording.path || null,
    query: recording.query || null,
    noteMask: recording.noteMask || "",
    source: {
      provider: recording.source?.provider || "Unknown",
      location: recording.source?.location || null,
      recordist: recording.source?.recordist || null,
      license: recording.source?.license || null,
      url: recording.source?.url || null,
      capturedAt: recording.source?.capturedAt || null,
      xenoCantoId: recording.source?.xenoCantoId || null,
    },
  };
}

export const BIRDS = birdsData.map((bird) => ({
  id: bird.id,
  name: bird.name,
  silhouette: bird.silhouette,
  photo: bird.photo || null,
  recordings: (bird.recordings || []).map((recording, idx) => normalizeRecording(recording, idx, bird.id)),
}));

export function hasLocalRecording(bird) {
  return Boolean(bird?.recordings?.some((recording) => Boolean(recording?.path)));
}

export function getPrimaryLocalRecording(bird) {
  return bird?.recordings?.find((recording) => Boolean(recording?.path)) || null;
}

export function getPrimaryRecording(bird) {
  return bird?.recordings?.[0] || null;
}
