import { PriorityScoreInput } from '../types/index';

export function calculatePriorityScore(input: PriorityScoreInput): number {
  const affectedFactor = Math.min(Math.log10(Math.max(input.affectedUrlsCount, 1)) + 1, 5);
  const numerator = input.impact * input.confidence * affectedFactor * input.businessImportance;
  const denominator = Math.max(input.effort * input.risk, 1);
  const score = numerator / denominator;
  return Math.round(score * 10) / 10;
}
