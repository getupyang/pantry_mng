import test from "node:test";
import assert from "node:assert/strict";

import { LIMITS } from "../api/openrouter.js";

test("batch intake keeps abuse protection while allowing sustained recognition", () => {
  assert.deepEqual(LIMITS, {
    clientHour: 30,
    clientDay: 120,
    familyDay: 300,
    ipHour: 90,
    ipDay: 240,
  });
});
