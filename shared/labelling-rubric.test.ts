import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ACNE_LEVELS, SKIN_TYPE_LEVELS, PRESENCE_LEVELS, ANNOTATION_FIELDS } from "./training-queue";

/**
 * The labelling rubric lives in two files that serve different readers:
 *
 *   docs/LABELLING-CONTEXT.md      pasted into a fresh conversation (no repo)
 *   .claude/skills/face-labelling  loaded by the labelling agent
 *
 * They have already diverged once — the doc kept criteria the skill had
 * replaced, so which rubric applied depended on how the annotator was invoked.
 * These tests pin them to each other and to the code.
 */
const root = resolve(__dirname, "..");
const DOC = readFileSync(resolve(root, "docs/LABELLING-CONTEXT.md"), "utf8");
const SKILL = readFileSync(resolve(root, ".claude/skills/face-labelling/SKILL.md"), "utf8");

const BINARY = ANNOTATION_FIELDS.filter((f) => f.key !== "acne" && f.key !== "skintype");

/**
 * One attribute's own section, bounded at the next `---` divider.
 *
 * Bounding is the whole point: an unbounded split returns everything after the
 * heading, so a LATER attribute's "Decision Rule" satisfies an earlier one whose
 * rule was deleted — the test passes while the rubric is broken. That is exactly
 * what happened when this test was first written.
 */
function sectionFor(key: string): string {
  return DOC.split(`**\`${key}\`**`)[1]?.split("\n---")[0] ?? "";
}

describe("labelling rubric", () => {
  it("states every vocabulary the code accepts", () => {
    for (const v of [...ACNE_LEVELS, ...SKIN_TYPE_LEVELS, ...PRESENCE_LEVELS]) {
      expect(DOC, `doc missing "${v}"`).toContain(v);
      expect(SKILL, `skill missing "${v}"`).toContain(v);
    }
  });

  it("covers every gradeable attribute in both files", () => {
    for (const f of ANNOTATION_FIELDS) {
      expect(DOC, `doc missing ${f.key}`).toContain(`\`${f.key}\``);
      expect(SKILL, `skill missing ${f.key}`).toContain(`\`${f.key}\``);
    }
  });

  it("gives every binary attribute a Decision Rule and exclusions", () => {
    // The over-firing this rubric was rewritten to fix came from criteria that
    // said what a finding IS without saying where it stops.
    for (const f of BINARY) {
      const section = sectionFor(f.key);
      expect(section, `${f.key}: no Decision Rule`).toContain("Decision Rule");
      expect(section, `${f.key}: no exclusions`).toContain("Do NOT count");
    }
  });

  it("states what absent looks like, not just present", () => {
    // A criterion that only defines `present` makes `absent` a default rather
    // than a judgement, which is how a column reaches 90% present.
    for (const f of BINARY) {
      const section = sectionFor(f.key);
      expect(section, `${f.key}: no absent criterion`).toMatch(/\*\*`absent`\*\*/);
    }
  });

  it("keeps the gates that make criteria camera- and cohort-independent", () => {
    for (const [name, gate] of Object.entries({
      viewing: /never zoom/i,
      expression: /Expression/,
      makeup: /[Mm]akeup/,
      multiAngle: /[Mm]ulti-angle/,
      sameFace: /[Ss]ame-face baseline/,
    })) {
      expect(DOC, `doc lost the ${name} gate`).toMatch(gate);
      expect(SKILL, `skill lost the ${name} gate`).toMatch(gate);
    }
  });

  it("never reintroduces the retired severity words as binary values", () => {
    // "mild"/"moderate" are legal for acne only. If they creep back into a
    // binary attribute's criteria the annotator will emit them and the row is
    // silently dropped by the backend.
    for (const f of BINARY) {
      const section = sectionFor(f.key);
      expect(section, `${f.key}: offers a severity word`).not.toMatch(
        /\*\*`(mild|moderate|severe|none)`\*\*/,
      );
    }
  });
});
