import { describe, expect, it } from "vitest";
import {
  checkCommentary, repairSelection, SELECTION_CRITERIA, GROUNDING_RULES, selectionPrompt, splitSentences,
  sufficiency, unsupportedNumbers, validateSelection, type Candidate, type Selection,
} from "../lib/editorial";

const TOPICS = ["Funding & Deals", "AI & Deeptech", "Fintech", "Policy & Regulation", "Markets & IPOs"];
const cands: Candidate[] = Array.from({ length: 20 }, (_, i) => ({
  id: i + 1, title: `Story ${i + 1}`, source_name: "Src", topic: TOPICS[i % TOPICS.length], summary: "s", published_at: null, url: `https://x.test/${i}`,
}));
const sel = (ids: number[], reserves: number[] = [15, 16, 17, 18, 19]): Selection => ({
  selected: ids.map((id, i) => ({ article_id: id, position: i + 1, rationale: "r" })),
  reserves: reserves.map((id, i) => ({ article_id: id, rank: i + 1, rationale: "r" })),
});

describe("selection validator (D1, D2)", () => {
  it("accepts a valid 9-story, 5-topic selection", () => {
    expect(validateSelection(sel([1, 2, 3, 4, 5, 6, 7, 8, 9]), cands)).toEqual([]);
  });
  it("rejects too few and too many stories", () => {
    expect(validateSelection(sel([1, 2, 3, 4, 5, 6, 7]), cands).join()).toMatch(/selected 7 stories; must be 8–10/);
    expect(validateSelection(sel([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), cands).join()).toMatch(/selected 11 stories/);
  });
  it("rejects fewer than 3 topics", () => {
    // ids 1, 6, 11 … are Funding; 2, 7, 12 … are AI → only 2 topics
    expect(validateSelection(sel([1, 6, 11, 16, 2, 7, 12, 17]), cands, new Set()).join()).toMatch(/only 2 topic/);
  });
  it("rejects unknown IDs, duplicates and past-issue overlap", () => {
    const errs = validateSelection(sel([1, 2, 3, 4, 5, 6, 7, 999, 3]), cands, new Set([4])).join("\n");
    expect(errs).toMatch(/999 is not in the candidate list/);
    expect(errs).toMatch(/duplicate article_id\(s\): 3/);
    expect(errs).toMatch(/4 was covered in one of the last four issues/);
  });
  it("repairs deterministically: drops invalid IDs, fills to 8 and restores 3 topics", () => {
    const bad = sel([1, 6, 11, 999, 6], [16, 2]);
    const { selection, log } = repairSelection(bad, cands);
    expect(validateSelection(selection, cands)).toEqual([]);
    expect(selection.selected.length).toBeGreaterThanOrEqual(8);
    expect(selection.reserves).toHaveLength(5);
    expect(log.join()).toMatch(/dropped invalid\/duplicate id 999/);
  });
  it("trims an over-long selection to 10", () => {
    const { selection } = repairSelection(sel([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]), cands);
    expect(selection.selected).toHaveLength(10);
  });
});

describe("prompt content (D3, D5, D6)", () => {
  it("states the editorial criteria verbatim and includes voice guide + past headlines", () => {
    const p = selectionPrompt(cands.slice(0, 3), "VOICE-GUIDE-MARKER", [{ issue_number: 4, title: "Past headline X" }]);
    expect(SELECTION_CRITERIA).toMatch(/High signal-to-noise relative to this week's batch/);
    expect(SELECTION_CRITERIA).toMatch(/counterintuitive, under-reported, or connect two trends others haven't linked/);
    expect(SELECTION_CRITERIA).toMatch(/Skip PR fluff, routine announcements, and duplicates of the same event/);
    expect(p).toContain(SELECTION_CRITERIA);
    expect(p).toContain("VOICE-GUIDE-MARKER");
    expect(p).toContain("#4: Past headline X");
    expect(GROUNDING_RULES).toMatch(/Never invent numbers/);
  });
  it("sufficiency needs 12 candidates and 3 topics", () => {
    expect(sufficiency(cands.slice(0, 11)).enough).toBe(false);
    expect(sufficiency(cands.slice(0, 12)).enough).toBe(true);
    expect(sufficiency(cands.filter((c) => c.topic === "Fintech" || c.topic === "AI & Deeptech")).enough).toBe(false);
  });
});

describe("commentary checks (D4, D6)", () => {
  it("counts sentences", () => {
    expect(splitSentences("One. Two! Three? Four.")).toHaveLength(4);
    expect(splitSentences("Raised ₹50 crore. Rs. 5 is cheap.")).toHaveLength(2);
  });
  it("trims to 3 sentences and flags fewer than 2", () => {
    expect(checkCommentary("A. B. C. D.", "src").commentary).toBe("A. B. C.");
    expect(checkCommentary("Only one sentence here.", "src").needsReview).toBe(true);
  });
  it("flags numbers that are not in the source", () => {
    const src = "Zetwerk sets IPO price band at Rs 143-151; eyes Rs 5,012 Cr from issue";
    expect(unsupportedNumbers("The Rs 5,012 crore issue at 143 to 151 is big.", src)).toEqual([]);
    expect(unsupportedNumbers("A ₹9,000 crore valuation and 40% growth.", src)).toEqual(["9000", "40"]);
    const c = checkCommentary("Zetwerk wants Rs 5,012 crore. That implies a 40x multiple, I think.", src);
    expect(c.needsReview).toBe(true);
    expect(c.notes.join()).toMatch(/40/);
  });
});
