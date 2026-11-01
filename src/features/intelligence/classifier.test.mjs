import assert from "node:assert/strict";
import test from "node:test";
import * as tf from "@tensorflow/tfjs";
import { exampleDataset, prepareTrainingData, trainClassifier, validateDataset } from "./classifier.js";

test("dataset validation rejects missing, nonfinite, ragged, and nonbinary data", () => {
  assert.throws(() => validateDataset({}), { code: "invalid_dataset" });
  const nonfinite = exampleDataset(); nonfinite.samples[0].features[0] = NaN;
  assert.throws(() => validateDataset(nonfinite), { code: "invalid_dataset" });
  const ragged = exampleDataset(); ragged.samples[0].features.pop();
  assert.throws(() => validateDataset(ragged), { code: "invalid_dataset" });
  const nonbinary = exampleDataset(); nonbinary.samples[0].label = 2;
  assert.throws(() => validateDataset(nonbinary), { code: "invalid_dataset" });
  const oneClass = exampleDataset(); oneClass.samples.forEach((sample) => sample.label = 0);
  assert.throws(() => validateDataset(oneClass), { code: "invalid_dataset" });
  const tooFew = exampleDataset(); tooFew.samples = tooFew.samples.slice(0, 19);
  assert.throws(() => validateDataset(tooFew), { code: "invalid_dataset" });
});

test("stratified holdout has both classes, no overlap, and normalization excludes test rows", () => {
  const dataset = exampleDataset();
  const first = prepareTrainingData(dataset);
  const second = prepareTrainingData(dataset);
  assert.deepEqual(first.train, second.train);
  assert.deepEqual(first.test, second.test);
  assert.ok(first.test.length >= dataset.samples.length * 0.2);
  assert.equal(first.train.length + first.test.length, dataset.samples.length);
  assert.deepEqual([...new Set(first.test.map((row) => row.label))].sort(), [0, 1]);
  const changed = structuredClone(dataset);
  const heldOutRow = first.test[0];
  const index = changed.samples.findIndex((row) => row.label === heldOutRow.label && row.features.every((value, feature) => value === heldOutRow.features[feature]));
  assert.ok(index >= 0);
  changed.samples[index].features = [1e9, -1e9];
  const after = prepareTrainingData(changed);
  assert.deepEqual(first.means, after.means, "A held-out outlier must not leak into normalization");
  assert.deepEqual(first.scales, after.scales);
});

test("actual TensorFlow training, held-out evaluation, predictions, and disposal execute", { timeout: 60000 }, async () => {
  await tf.setBackend("cpu");
  await tf.ready();
  const before = tf.memory().numTensors;
  const epochs = [];
  const trained = await trainClassifier(exampleDataset(), { epochs: 10, onEpoch: (epoch) => { epochs.push(epoch); } });
  assert.deepEqual(epochs, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(trained.metrics.trainCount, 96);
  assert.equal(trained.metrics.testCount, 24);
  assert.equal(trained.metrics.synthetic, true);
  assert.ok(Number.isFinite(trained.metrics.loss));
  assert.ok(trained.metrics.accuracy >= 0.9, `Synthetic held-out accuracy was ${trained.metrics.accuracy}`);
  for (const name of ["accuracy", "precision", "recall"]) assert.ok(trained.metrics[name] >= 0 && trained.metrics[name] <= 1);
  const negative = await trained.predict([0.1, 0.1]);
  const positive = await trained.predict([0.85, 0.85]);
  assert.equal(negative.label, 0);
  assert.equal(positive.label, 1);
  assert.ok(positive.probability > negative.probability);
  await assert.rejects(trained.predict([1]), { code: "invalid_features" });
  await assert.rejects(trained.predict([Infinity, 0]), { code: "invalid_features" });
  trained.dispose();
  trained.dispose();
  await assert.rejects(trained.predict([0.85, 0.85]), { code: "model_disposed" });
  assert.equal(tf.memory().numTensors, before, "Training and inference must release all tensors after dispose");
});

test("cancellation during actual training stops the model and releases tensors", { timeout: 60000 }, async () => {
  const before = tf.memory().numTensors;
  const controller = new AbortController();
  await assert.rejects(trainClassifier(exampleDataset(), {
    epochs: 50, signal: controller.signal,
    onEpoch: () => controller.abort(),
  }), { code: "training_cancelled" });
  assert.equal(tf.memory().numTensors, before);
  await assert.rejects(trainClassifier(exampleDataset(), { signal: controller.signal }), { code: "training_cancelled" });
});

test("retraining after a disposed/cancelled model and callback errors leave no state behind", { timeout: 60000 }, async () => {
  const before = tf.memory().numTensors;
  await assert.rejects(trainClassifier(exampleDataset(), { epochs: 1, onEpoch: () => { throw new Error("UI callback failed"); } }), { code: "training_failed" });
  assert.equal(tf.memory().numTensors, before);
  const trained = await trainClassifier(exampleDataset(), { epochs: 1 });
  assert.ok(Number.isFinite((await trained.predict([0.5, 0.5])).probability));
  trained.dispose();
  assert.equal(tf.memory().numTensors, before);
  await assert.rejects(trainClassifier(exampleDataset(), { epochs: 51 }), { code: "invalid_options" });
  await assert.rejects(trainClassifier(exampleDataset(), { signal: { aborted: false, addEventListener() {} } }), { code: "invalid_options" });
});
