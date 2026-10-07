import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  extractImageDataUrls,
  sanitizeVisionRequest,
  serializeReviewImages,
} from "../api/openrouter.js";
import { normalizeReviewImages } from "../api/admin/recognition-reviews.js";

const image = (url) => ({ type: "image_url", image_url: { url } });
const dataUrls = [
  "data:image/jpeg;base64,Zmlyc3Q=",
  "data:image/png;base64,c2Vjb25k",
  "data:image/webp;base64,dGhpcmQ=",
  "data:image/jpeg;base64,Zm91cnRo",
];
const request = (nodes) => ({
  model: "google/gemini-2.5-flash",
  messages: [{ role: "user", content: nodes }],
  max_tokens: 99999,
  temperature: 4,
});

test("photo accepts one image_url node", () => {
  const result = sanitizeVisionRequest(request([image(dataUrls[0])]), "photo");
  assert.equal(result.error, undefined);
  assert.equal(result.body.max_tokens, 2200);
  assert.equal(result.body.temperature, 1);
  assert.deepEqual(result.body.messages, request([image(dataUrls[0])]).messages);
});

test("photo accepts three image_url nodes", () => {
  const result = sanitizeVisionRequest(request(dataUrls.slice(0, 3).map(image)), "photo");
  assert.equal(result.error, undefined);
});

test("photo rejects a remote image_url even when a valid data image is present", () => {
  const result = sanitizeVisionRequest(
    request([image(dataUrls[0]), image("https://example.test/remote.jpg")]),
    "photo",
  );
  assert.match(result.error, /image_url|data:image|invalid/i);
});

test("photo rejects malformed image_url objects instead of ignoring them", () => {
  for (const malformed of [
    { type: "image_url", image_url: "not-an-object" },
    { type: "image_url", image_url: {} },
    { type: "image_url", image_url: { url: 42 } },
  ]) {
    const result = sanitizeVisionRequest(request([image(dataUrls[0]), malformed]), "photo");
    assert.match(result.error, /image_url|data:image|invalid/i);
  }
});

test("photo rejects zero or four images with a 1..3 error", () => {
  for (const nodes of [[], dataUrls.map(image), [
    image(dataUrls[0]), image(dataUrls[1]), image(dataUrls[2]), image(dataUrls[0]),
  ]]) {
    const result = sanitizeVisionRequest(request(nodes), "photo");
    assert.match(result.error, /1[^\d]+3|1\.\.3/i);
  }
});

test("order accepts exactly one screenshot and rejects zero or two", () => {
  assert.equal(sanitizeVisionRequest(request([image(dataUrls[0])]), "order").error, undefined);
  for (const nodes of [[], dataUrls.slice(0, 2).map(image)]) {
    assert.match(
      sanitizeVisionRequest(request(nodes), "order").error,
      /exactly 1|one image/i,
    );
  }
});

test("text beginning with a data image URL is not counted as an image", () => {
  const result = sanitizeVisionRequest(
    request([{ type: "text", text: "data:image/png;base64,not-an-image-node" }]),
    "photo",
  );
  assert.match(result.error, /1[^\d]+3|1\.\.3/i);
});

test("data-looking nested text is not counted as an image", () => {
  const result = sanitizeVisionRequest(
    request([{ type: "text", text: `ignore ${dataUrls[0]}` }, { nested: image(dataUrls[1]) }]),
    "photo",
  );
  assert.match(result.error, /content|unsupported|1[^\d]+3|1\.\.3/i);
});

test("unsupported message content shapes are rejected", () => {
  for (const content of [
    [{ type: "audio", audio: "unsafe" }, image(dataUrls[0])],
    [{ text: "missing type" }, image(dataUrls[0])],
    { type: "image_url", image_url: { url: dataUrls[0] } },
  ]) {
    const body = request([]);
    body.messages[0].content = content;
    assert.match(sanitizeVisionRequest(body, "photo").error, /content|unsupported|messages/i);
  }
});

test("sanitized body forwards only normalized roles, text, and validated image nodes", () => {
  const body = request([
    { type: "text", text: "inspect", ignored: "drop-me" },
    { type: "image_url", image_url: { url: dataUrls[0], detail: "high" }, ignored: true },
  ]);
  body.messages[0].ignored = { secret: true };
  const result = sanitizeVisionRequest(body, "photo");
  assert.equal(result.error, undefined);
  assert.deepEqual(result.body.messages, [{
    role: "user",
    content: [
      { type: "text", text: "inspect" },
      { type: "image_url", image_url: { url: dataUrls[0] } },
    ],
  }]);
  assert.deepEqual(extractImageDataUrls(result.body.messages), [dataUrls[0]]);
});

test("extractImageDataUrls returns image_url data URLs in traversal order", () => {
  const value = {
    messages: [
      {
        content: [
          image(dataUrls[0]),
          { type: "text", text: dataUrls[3] },
          { nested: [image(dataUrls[1]), { ignored: dataUrls[3] }] },
          image(dataUrls[2]),
        ],
      },
    ],
  };
  assert.deepEqual(extractImageDataUrls(value), dataUrls.slice(0, 3));
});

test("serializeReviewImages preserves the legacy one-image representation", () => {
  assert.equal(serializeReviewImages([]), null);
  assert.equal(serializeReviewImages([dataUrls[0]]), dataUrls[0]);
  assert.equal(
    serializeReviewImages(dataUrls.slice(0, 3)),
    JSON.stringify(dataUrls.slice(0, 3)),
  );
});

test("normalizeReviewImages exposes the first image and the complete array", () => {
  assert.deepEqual(normalizeReviewImages(dataUrls[0]), {
    imageDataUrl: dataUrls[0],
    imageDataUrls: [dataUrls[0]],
  });
  assert.deepEqual(normalizeReviewImages(JSON.stringify(dataUrls.slice(0, 3))), {
    imageDataUrl: dataUrls[0],
    imageDataUrls: dataUrls.slice(0, 3),
  });
});

test("normalizeReviewImages handles invalid and empty stored values safely", () => {
  for (const value of [null, "", "not-json-or-an-image", "[]", "[null,\"bad\"]", "{"]) {
    assert.deepEqual(normalizeReviewImages(value), {
      imageDataUrl: null,
      imageDataUrls: [],
    });
  }
});

test("HTTP handler sanitizes using the derived recognition type", () => {
  const source = fs.readFileSync(new URL("../api/openrouter.js", import.meta.url), "utf8");
  assert.match(source, /sanitizeVisionRequest\(body,\s*reqType\)/);
});
