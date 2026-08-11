import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import {
  MAX_CANONICAL_PAGE_BYTES,
  canonicalPageBytes,
  computePageObjectId,
} from "../objectIdentity.ts";
import type { ObjectId, PageRevisionV1 } from "../types.ts";

const bundleRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../schemas/masthead-pages/v1",
);

type ObjectIdVector = {
  name: string;
  objectId: ObjectId;
  object: PageRevisionV1;
};

const vectors = JSON.parse(
  readFileSync(join(bundleRoot, "vectors/page-object-ids.json"), "utf8"),
) as ObjectIdVector[];

describe("masthead pages object identity", () => {
  test.each(vectors)("matches hosted object identity $objectId", ({ object, objectId }) => {
    expect(computePageObjectId(object)).toBe(objectId);
  });

  test("canonical bytes exclude null optional fields", () => {
    const minimal = vectors.find((vector) => vector.name === "minimal.valid.json");
    expect(minimal).toBeDefined();
    const bytes = canonicalPageBytes(minimal!.object);
    expect(new TextDecoder().decode(bytes)).not.toContain("null");
    expect(bytes.byteLength).toBeLessThan(MAX_CANONICAL_PAGE_BYTES);
  });

  test("is deterministic across repeated calls", () => {
    const complete = vectors.find((vector) => vector.name === "complete.valid.json");
    expect(complete).toBeDefined();
    expect(computePageObjectId(complete!.object)).toBe(
      computePageObjectId(complete!.object),
    );
    expect(computePageObjectId(complete!.object)).toBe(complete!.objectId);
  });
});
