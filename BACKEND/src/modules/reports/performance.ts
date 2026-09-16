/**
 * Performance scoring (arch doc §20). Pure functions so the weighting is testable
 * and explainable: a score is never a black box, it is four visible signals.
 *
 * Attendance is participation data, not a verdict on a person — it is one input
 * among four, and the weights are organization policy, not a hard-coded judgement.
 */

export interface ScoreWeights {
  /** Share of tasks finished. */
  completion: number;
  /** Share of finished tasks that met their due date. */
  deadlines: number;
  /** Share of active tasks carrying a recent work update. */
  updates: number;
  /** Share of ended meetings actually attended. */
  attendance: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  completion: 40,
  deadlines: 25,
  updates: 20,
  attendance: 15,
};

export interface ScoreInput {
  tasksTotal: number;
  tasksCompleted: number;
  tasksOnTime: number;
  /** Tasks that are open and should therefore carry an update. */
  tasksActive: number;
  tasksWithRecentUpdate: number;
  meetingsTotal: number;
  meetingsAttended: number;
}

export interface ScoreBreakdown {
  completion: number | null;
  deadlines: number | null;
  updates: number | null;
  attendance: number | null;
}

export interface Score {
  /** 0–100, or null when there is nothing to measure yet. */
  score: number | null;
  breakdown: ScoreBreakdown;
  weights: ScoreWeights;
}

const percent = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

/**
 * Signals with no data are dropped and the remaining weights are rescaled, so a
 * team that holds no meetings is not punished for a missing attendance figure.
 */
export function computeScore(input: ScoreInput, weights: ScoreWeights = DEFAULT_WEIGHTS): Score {
  const breakdown: ScoreBreakdown = {
    completion: percent(input.tasksCompleted, input.tasksTotal),
    deadlines: percent(input.tasksOnTime, input.tasksCompleted),
    updates: percent(input.tasksWithRecentUpdate, input.tasksActive),
    attendance: percent(input.meetingsAttended, input.meetingsTotal),
  };

  const parts = (Object.keys(weights) as (keyof ScoreWeights)[])
    .map((key) => ({ value: breakdown[key], weight: weights[key] }))
    .filter((p): p is { value: number; weight: number } => p.value !== null && p.weight > 0);

  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  const score = totalWeight > 0 ? Math.round(parts.reduce((sum, p) => sum + p.value * p.weight, 0) / totalWeight) : null;

  return { score, breakdown, weights };
}

export function readWeights(config: unknown): ScoreWeights {
  const raw = ((config ?? {}) as { weights?: Partial<ScoreWeights> }).weights ?? {};
  const pick = (key: keyof ScoreWeights) => {
    const value = Number(raw[key]);
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_WEIGHTS[key];
  };
  return {
    completion: pick('completion'),
    deadlines: pick('deadlines'),
    updates: pick('updates'),
    attendance: pick('attendance'),
  };
}
