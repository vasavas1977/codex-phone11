import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const prompt = fileURLToPath(
  new URL(
    "../infra/configs/freeswitch/prompts/recording-ai-notice-en-male.wav",
    import.meta.url,
  ),
);

test("recording announcement is short telephone-compatible PCM", () => {
  const wav = readFileSync(prompt);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");

  const fmt = wav.indexOf(Buffer.from("fmt "));
  const data = wav.indexOf(Buffer.from("data"));
  assert.ok(fmt >= 12 && data > fmt, "required WAV chunks are present");
  assert.equal(wav.readUInt16LE(fmt + 8), 1, "signed PCM format");
  assert.equal(wav.readUInt16LE(fmt + 10), 1, "mono");
  assert.equal(wav.readUInt32LE(fmt + 12), 8_000, "8 kHz sample rate");
  assert.equal(wav.readUInt16LE(fmt + 22), 16, "16-bit samples");

  const seconds = wav.readUInt32LE(data + 4) / 16_000;
  assert.ok(seconds >= 1.5 && seconds <= 4, `unexpected ${seconds}s prompt`);
});
