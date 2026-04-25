/**
 * Mask overlap scoring for Sing mode. Weights blend:
 * - targetCovered: how much of the editor mask you activated
 * - (1 - outsideRatio): how little of your energy sits outside that mask
 */

export const SCORING_DIFFICULTIES = [
  { id: "gentle", label: "Gentle", ratioLabel: "9:1", wWithin: 0.9, wOff: 0.1 },
  { id: "moderate", label: "Moderate", ratioLabel: "8:2", wWithin: 0.8, wOff: 0.2 },
  { id: "firm", label: "Firm", ratioLabel: "7:3", wWithin: 0.7, wOff: 0.3 },
  { id: "strict", label: "Strict", ratioLabel: "6:4", wWithin: 0.6, wOff: 0.4 },
];

export const DEFAULT_SCORING_DIFFICULTY_ID = "gentle";

export function getScoringDifficulty(difficultyId) {
  return SCORING_DIFFICULTIES.find((d) => d.id === difficultyId) || SCORING_DIFFICULTIES[0];
}

export function scoreMaskOverlap(targetMask, userMask, difficultyId = DEFAULT_SCORING_DIFFICULTY_ID) {
  const n = Math.min(targetMask?.length || 0, userMask?.length || 0);
  if (!n) return { score: 0, hasTarget: false };

  const { wWithin, wOff } = getScoringDifficulty(difficultyId);
  let targetPixels = 0;
  let userPixels = 0;
  let intersection = 0;
  for (let i = 0; i < n; i++) {
    const t = targetMask[i] > 0;
    const u = userMask[i] > 0;
    if (t) targetPixels += 1;
    if (u) userPixels += 1;
    if (t && u) intersection += 1;
  }
  if (!targetPixels) return { score: 0, hasTarget: false };
  const targetCovered = intersection / targetPixels;
  const outsidePixels = Math.max(0, userPixels - intersection);
  const outsideRatio = userPixels ? outsidePixels / userPixels : 1;
  const raw = 100 * (wWithin * targetCovered + wOff * (1 - outsideRatio));
  return { score: Math.round(Math.max(0, Math.min(100, raw))), hasTarget: true };
}

export function bestScoreKey(birdId, difficultyId) {
  return `${birdId}:${difficultyId}`;
}
