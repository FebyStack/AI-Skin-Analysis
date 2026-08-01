// @vitest-environment node
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { labelFiles } from "./label-files";

/**
 * Annotating is the expensive step, so an image that has been labelled must
 * never be offered again. That guarantee rests entirely on finding every output
 * file — a missed shard means the whole batch gets re-labelled.
 */
const root = mkdtempSync(path.join(tmpdir(), "skin-labelfiles-"));
const dir = path.join(root, "_annotate");

beforeEach(() => {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

const write = (name: string) => writeFileSync(path.join(dir, name), "{}\n");
const names = () => labelFiles(dir).map((f) => path.basename(f));

describe("labelFiles", () => {
  it("finds parallel shards, not just labels.jsonl", () => {
    // Concurrent labelling runs shard their output so appends cannot interleave.
    // Reading only labels.jsonl re-staged every finished shard.
    write("labels.jsonl");
    write("labels-aa.jsonl");
    write("labels-ab.jsonl");
    expect(names()).toEqual(["labels-aa.jsonl", "labels-ab.jsonl", "labels.jsonl"]);
  });

  it("ignores the inputs sitting in the same directory", () => {
    // manifest.jsonl and batch-*.jsonl are what still NEEDS labelling. Counting
    // them as output would skip every image before anyone looked at it.
    write("labels.jsonl");
    write("manifest.jsonl");
    write("batch-aa.jsonl");
    expect(names()).toEqual(["labels.jsonl"]);
  });

  it("returns empty for a directory that does not exist yet", () => {
    expect(labelFiles(path.join(root, "nope"))).toEqual([]);
  });
});
