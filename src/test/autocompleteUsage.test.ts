import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bumpCompletionUsage, completionUsageToSeries, utcDayStart, type CompletionUsageDay } from "../autocomplete/usage.js";

const DAY = 24 * 60 * 60 * 1000;

describe("autocomplete usage — bumpCompletionUsage", () => {
  it("increments the right counter for an existing day", () => {
    const days: CompletionUsageDay[] = [{ dayStart: 1000, suggested: 2, approved: 1 }];
    bumpCompletionUsage(days, 1000, "suggested");
    bumpCompletionUsage(days, 1000, "approved");
    assert.deepEqual(days, [{ dayStart: 1000, suggested: 3, approved: 2 }]);
  });

  it("creates a day entry on first use and caps retention", () => {
    const days: CompletionUsageDay[] = [];
    bumpCompletionUsage(days, 500, "suggested", 2);
    assert.equal(days.length, 1);
    bumpCompletionUsage(days, 1000, "suggested", 2);
    bumpCompletionUsage(days, 1500, "suggested", 2);
    assert.equal(days.length, 2, "oldest day evicted past the cap");
    assert.equal(days[0].dayStart, 1000);
  });
});

describe("autocomplete usage — completionUsageToSeries", () => {
  const dayMs = utcDayStart(Date.now());

  it("emits fixed windows with zero-filled days", () => {
    const days: CompletionUsageDay[] = [
      { dayStart: dayMs, suggested: 3, approved: 1 },
      { dayStart: dayMs - DAY, suggested: 5, approved: 2 },
    ];
    const series = completionUsageToSeries(days, dayMs, 7);
    assert.equal(series.length, 7);
    assert.equal(series[6].suggested, 3);
    assert.equal(series[6].approved, 1);
    assert.equal(series[5].suggested, 5);
    assert.equal(series[0].suggested, 0, "empty days are zero-filled");
  });

  it("lifetime windows span from the earliest stored day", () => {
    const days: CompletionUsageDay[] = [
      { dayStart: dayMs - 5 * DAY, suggested: 1, approved: 0 },
      { dayStart: dayMs, suggested: 4, approved: 2 },
    ];
    const series = completionUsageToSeries(days, dayMs, 0);
    assert.equal(series.length, 6);
    assert.equal(series[0].suggested, 1);
    assert.equal(series[5].suggested, 4);
  });

  it("empty history still yields a single today bucket", () => {
    const series = completionUsageToSeries([], dayMs, 0);
    assert.equal(series.length, 1);
    assert.equal(series[0].dayStart, dayMs);
    assert.equal(series[0].suggested, 0);
  });

  it("honors an explicit first day so both charts share buckets", () => {
    const days: CompletionUsageDay[] = [{ dayStart: dayMs, suggested: 2, approved: 1 }];
    // The usage series may start earlier (e.g. 5 days back on lifetime);
    // the completion series must span the same range with zero-fills.
    const first = dayMs - 5 * DAY;
    const series = completionUsageToSeries(days, dayMs, 0, first);
    assert.equal(series.length, 6);
    assert.equal(series[0].dayStart, first);
    assert.equal(series[5].dayStart, dayMs);
    assert.equal(series[5].suggested, 2);
    assert.equal(series[0].suggested, 0);
  });
});
