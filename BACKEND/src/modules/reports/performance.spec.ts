import { DEFAULT_WEIGHTS, computeScore, readWeights } from './performance.js';

const input = (over: Partial<Parameters<typeof computeScore>[0]> = {}) => ({
  tasksTotal: 10,
  tasksCompleted: 8,
  tasksOnTime: 6,
  tasksActive: 2,
  tasksWithRecentUpdate: 1,
  meetingsTotal: 4,
  meetingsAttended: 3,
  ...over,
});

describe('computeScore', () => {
  it('turns the four signals into percentages', () => {
    const { breakdown } = computeScore(input());
    expect(breakdown).toEqual({ completion: 80, deadlines: 75, updates: 50, attendance: 75 });
  });

  it('weights the signals as configured', () => {
    // 80*40 + 75*25 + 50*20 + 75*15 = 7200 / 100
    expect(computeScore(input()).score).toBe(72);
  });

  it('rescales when a signal has no data, instead of scoring it zero', () => {
    const noMeetings = computeScore(input({ meetingsTotal: 0, meetingsAttended: 0 }));
    expect(noMeetings.breakdown.attendance).toBeNull();
    // 3200 + 1875 + 1000 = 6075, over the remaining weight of 85
    expect(noMeetings.score).toBe(71);
  });

  it('returns null rather than 0 when nothing has happened yet', () => {
    const empty = computeScore({
      tasksTotal: 0,
      tasksCompleted: 0,
      tasksOnTime: 0,
      tasksActive: 0,
      tasksWithRecentUpdate: 0,
      meetingsTotal: 0,
      meetingsAttended: 0,
    });
    expect(empty.score).toBeNull();
    expect(empty.breakdown.completion).toBeNull();
  });

  it('honours custom weights, including switching a signal off', () => {
    const tasksOnly = computeScore(input(), { completion: 100, deadlines: 0, updates: 0, attendance: 0 });
    expect(tasksOnly.score).toBe(80);
  });

  it('a perfect record scores 100', () => {
    const perfect = computeScore({
      tasksTotal: 5,
      tasksCompleted: 5,
      tasksOnTime: 5,
      tasksActive: 0,
      tasksWithRecentUpdate: 0,
      meetingsTotal: 3,
      meetingsAttended: 3,
    });
    expect(perfect.score).toBe(100);
  });
});

describe('readWeights', () => {
  it('falls back to defaults for missing or invalid values', () => {
    expect(readWeights(null)).toEqual(DEFAULT_WEIGHTS);
    expect(readWeights({ weights: { completion: 50, deadlines: -1 } })).toEqual({
      ...DEFAULT_WEIGHTS,
      completion: 50,
    });
  });
});
