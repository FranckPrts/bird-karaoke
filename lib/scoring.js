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

/**
 * @returns {{ score: number, hasTarget: boolean, breakdown: null | {
 *   targetPixels: number,
 *   userPixels: number,
 *   intersection: number,
 *   outsidePixels: number,
 *   missedTargetPixels: number,
 *   targetCovered: number,
 *   outsideRatio: number,
 *   coveragePoints: number,
 *   offMaskPoints: number,
 * }}}
 */
export function scoreMaskOverlap(targetMask, userMask, difficultyId = DEFAULT_SCORING_DIFFICULTY_ID) {
  const empty = { score: 0, hasTarget: false, breakdown: null };
  const n = Math.min(targetMask?.length || 0, userMask?.length || 0);
  if (!n) return empty;

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
  if (!targetPixels) return empty;

  const targetCovered = intersection / targetPixels;
  const outsidePixels = Math.max(0, userPixels - intersection);
  const outsideRatio = userPixels ? outsidePixels / userPixels : 1;
  const missedTargetPixels = targetPixels - intersection;
  const coveragePoints = 100 * wWithin * targetCovered;
  const offMaskPoints = 100 * wOff * (1 - outsideRatio);
  const raw = coveragePoints + offMaskPoints;
  return {
    score: Math.round(Math.max(0, Math.min(100, raw))),
    hasTarget: true,
    breakdown: {
      targetPixels,
      userPixels,
      intersection,
      outsidePixels,
      missedTargetPixels,
      targetCovered,
      outsideRatio,
      coveragePoints,
      offMaskPoints,
    },
  };
}

export function bestScoreKey(birdId, difficultyId) {
  return `${birdId}:${difficultyId}`;
}
