/** A local binary outcome classifier. Its outputs do not establish causal persuasion. */
export class ClassifierError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "ClassifierError";
    this.code = code;
  }
}

function invalidDataset(message) { return new ClassifierError("invalid_dataset", message); }

/** Validate and copy input so caller edits cannot change a running training job. */
export function validateDataset(dataset) {
  if (!dataset || typeof dataset !== "object" || !Array.isArray(dataset.featureNames) || !Array.isArray(dataset.samples)) {
    throw invalidDataset("Provide featureNames and samples arrays in the dataset JSON.");
  }
  const dimension = dataset.featureNames.length;
  if (dimension < 1 || dimension > 32) throw invalidDataset("A dataset must contain between 1 and 32 features.");
  const featureNames = dataset.featureNames.map((name) => {
    if (typeof name !== "string" || !name.trim() || name.length > 80) throw invalidDataset("Feature names must be nonempty strings of at most 80 characters.");
    return name.trim();
  });
  if (new Set(featureNames).size !== dimension) throw invalidDataset("Feature names must be unique.");
  if (dataset.samples.length < 20 || dataset.samples.length > 5000) throw invalidDataset("Provide between 20 and 5000 labeled samples.");
  const classCounts = [0, 0];
  const samples = dataset.samples.map((sample, index) => {
    if (!sample || !Array.isArray(sample.features) || sample.features.length !== dimension) {
      throw invalidDataset(`Sample ${index + 1} must contain ${dimension} numeric features.`);
    }
    if (sample.label !== 0 && sample.label !== 1) throw invalidDataset(`Sample ${index + 1} must have a binary label of 0 or 1.`);
    const features = sample.features.map((value) => {
      if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e12) {
        throw invalidDataset(`Sample ${index + 1} contains an invalid numeric feature; values must be finite and within ±1e12.`);
      }
      return value;
    });
    classCounts[sample.label] += 1;
    return { features, label: sample.label };
  });
  if (classCounts.some((count) => count < 2)) throw invalidDataset("Each class needs at least two samples for a separate training and held-out set.");
  return { featureNames, samples, synthetic: dataset.synthetic === true };
}

function randomGenerator(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, seed) {
  const result = items.slice();
  const random = randomGenerator(seed);
  for (let index = result.length - 1; index > 0; index--) {
    const next = Math.floor(random() * (index + 1));
    [result[index], result[next]] = [result[next], result[index]];
  }
  return result;
}

/** The deterministic stratified split and normalization are shared by training and tests. */
export function prepareTrainingData(dataset) {
  const validated = validateDataset(dataset);
  const training = [];
  const testing = [];
  for (const label of [0, 1]) {
    const rows = shuffle(validated.samples.filter((sample) => sample.label === label), 48271 + label);
    const heldOutCount = Math.min(rows.length - 1, Math.max(1, Math.ceil(rows.length * 0.2)));
    testing.push(...rows.slice(0, heldOutCount));
    training.push(...rows.slice(heldOutCount));
  }
  const train = shuffle(training, 1337);
  const test = shuffle(testing, 7331);
  const means = validated.featureNames.map((_, feature) => train.reduce((sum, row) => sum + row.features[feature], 0) / train.length);
  const scales = means.map((mean, feature) => {
    const variance = train.reduce((sum, row) => sum + (row.features[feature] - mean) ** 2, 0) / train.length;
    return Math.sqrt(variance) || 1;
  });
  const normalize = (features) => features.map((value, index) => (value - means[index]) / scales[index]);
  return { ...validated, train, test, means, scales, normalize };
}

function checkAbort(signal) {
  if (signal?.aborted) throw new ClassifierError("training_cancelled", "Training was cancelled.");
}

/**
 * @param {{featureNames: string[], samples: {features: number[], label: number}[], synthetic?: boolean}} dataset
 * @param {{epochs?: number, batchSize?: number, onEpoch?: (epoch: number, logs: Record<string, number>) => void | Promise<void>, signal?: AbortSignal}} options
 */
export async function trainClassifier(dataset, { epochs = 10, batchSize = 32, onEpoch, signal } = {}) {
  if (!Number.isInteger(epochs) || epochs < 1 || epochs > 50) throw new ClassifierError("invalid_options", "Epochs must be an integer between 1 and 50.");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 256) throw new ClassifierError("invalid_options", "Batch size must be an integer between 1 and 256.");
  if (onEpoch !== undefined && typeof onEpoch !== "function") throw new ClassifierError("invalid_options", "onEpoch must be a function.");
  if (signal !== undefined && (typeof signal?.aborted !== "boolean" || typeof signal?.addEventListener !== "function" || typeof signal?.removeEventListener !== "function")) {
    throw new ClassifierError("invalid_options", "signal must be an AbortSignal.");
  }
  checkAbort(signal);
  const prepared = prepareTrainingData(dataset);
  let tf;
  let model;
  let optimizer;
  let succeeded = false;
  let disposed = false;
  const tensors = [];
  const stopTraining = () => { if (model) model.stopTraining = true; };
  function disposeModel() {
    if (disposed) return;
    disposed = true;
    const errors = [];
    try { model?.dispose(); } catch (cause) { errors.push(cause); }
    try { optimizer?.dispose(); } catch (cause) { errors.push(cause); }
    if (errors.length) throw new ClassifierError("model_disposal_failed", "The classifier could not fully release its tensors.", errors[0]);
  }
  try {
    tf = await import("@tensorflow/tfjs");
    await tf.ready();
    checkAbort(signal);
    const dimension = prepared.featureNames.length;
    model = tf.sequential({ layers: [
      tf.layers.dense({ units: 64, activation: "relu", inputShape: [dimension], kernelInitializer: tf.initializers.glorotUniform({ seed: 17 }) }),
      tf.layers.dense({ units: 64, activation: "relu", kernelInitializer: tf.initializers.glorotUniform({ seed: 29 }) }),
      tf.layers.dense({ units: 1, activation: "sigmoid", kernelInitializer: tf.initializers.glorotUniform({ seed: 43 }) }),
    ] });
    optimizer = tf.train.adam();
    model.compile({ optimizer, loss: "binaryCrossentropy", metrics: ["accuracy"] });
    const makeTensor = (data, shape) => { const tensor = tf.tensor2d(data, shape, "float32"); tensors.push(tensor); return tensor; };
    const trainX = makeTensor(prepared.train.map((sample) => prepared.normalize(sample.features)), [prepared.train.length, dimension]);
    const trainY = makeTensor(prepared.train.map((sample) => [sample.label]), [prepared.train.length, 1]);
    const testX = makeTensor(prepared.test.map((sample) => prepared.normalize(sample.features)), [prepared.test.length, dimension]);
    const testY = makeTensor(prepared.test.map((sample) => [sample.label]), [prepared.test.length, 1]);
    signal?.addEventListener("abort", stopTraining, { once: true });
    await model.fit(trainX, trainY, {
      epochs,
      batchSize: Math.min(batchSize, prepared.train.length),
      shuffle: false,
      verbose: 0,
      yieldEvery: "batch",
      callbacks: {
        onBatchEnd: async () => { if (signal?.aborted) model.stopTraining = true; await tf.nextFrame(); },
        onEpochEnd: async (epoch, logs) => {
          checkAbort(signal);
          if (onEpoch) await onEpoch(epoch + 1, { ...logs });
          await tf.nextFrame();
        },
      },
    });
    checkAbort(signal);
    const evaluated = model.evaluate(testX, testY, { batchSize: Math.min(batchSize, prepared.test.length) });
    const evaluation = Array.isArray(evaluated) ? evaluated : [evaluated];
    tensors.push(...evaluation);
    const loss = (await evaluation[0].data())[0];
    const evaluatedAccuracy = evaluation[1] ? (await evaluation[1].data())[0] : null;
    const predictions = model.predict(testX);
    if (Array.isArray(predictions)) throw new Error("Unexpected multi-output classifier");
    tensors.push(predictions);
    const probabilities = await predictions.data();
    let truePositive = 0;
    let falsePositive = 0;
    let trueNegative = 0;
    let falseNegative = 0;
    probabilities.forEach((probability, index) => {
      if (!Number.isFinite(probability)) throw new Error("Training produced a non-finite prediction");
      const predicted = probability >= 0.5 ? 1 : 0;
      const actual = prepared.test[index].label;
      if (predicted === 1 && actual === 1) truePositive++;
      else if (predicted === 1) falsePositive++;
      else if (actual === 0) trueNegative++;
      else falseNegative++;
    });
    if (!Number.isFinite(loss) || (evaluatedAccuracy !== null && !Number.isFinite(evaluatedAccuracy))) throw new Error("Training produced non-finite evaluation metrics");
    const metrics = {
      trainCount: prepared.train.length,
      testCount: prepared.test.length,
      loss,
      accuracy: (truePositive + trueNegative) / prepared.test.length,
      precision: truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : 0,
      recall: truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : 0,
      truePositive, falsePositive, trueNegative, falseNegative,
      baselineAccuracy: Math.max(prepared.test.filter((sample) => sample.label === 0).length, prepared.test.filter((sample) => sample.label === 1).length) / prepared.test.length,
      synthetic: prepared.synthetic,
    };
    checkAbort(signal);
    succeeded = true;
    return {
      metrics,
      featureNames: prepared.featureNames.slice(),
      async predict(features) {
        if (disposed) throw new ClassifierError("model_disposed", "Train the classifier before making another prediction.");
        if (!Array.isArray(features) || features.length !== dimension || features.some((value) => typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 1e12)) {
          throw new ClassifierError("invalid_features", `Provide ${dimension} finite numeric features in the displayed order, within ±1e12.`);
        }
        let input;
        let output;
        try {
          input = tf.tensor2d([prepared.normalize(features)], [1, dimension], "float32");
          output = model.predict(input);
          if (Array.isArray(output)) throw new Error("Unexpected multi-output prediction");
          const probability = (await output.data())[0];
          if (!Number.isFinite(probability)) throw new Error("Prediction was not finite");
          return { probability, label: probability >= 0.5 ? 1 : 0 };
        } catch (cause) {
          if (cause instanceof ClassifierError) throw cause;
          throw new ClassifierError("prediction_failed", "The classifier could not produce a prediction.", cause);
        } finally {
          input?.dispose();
          if (Array.isArray(output)) tf.dispose(output);
          else output?.dispose();
        }
      },
      dispose: disposeModel,
    };
  } catch (cause) {
    if (signal?.aborted) throw new ClassifierError("training_cancelled", "Training was cancelled.", cause);
    if (cause instanceof ClassifierError) throw cause;
    throw new ClassifierError("training_failed", "Classifier training failed. Check the dataset and available browser resources.", cause);
  } finally {
    signal?.removeEventListener("abort", stopTraining);
    if (tf) tf.dispose(tensors);
    if (!succeeded) disposeModel();
  }
}

/** Explicitly synthetic examples for exercising the training workflow, not evidence of persuasion. */
export function exampleDataset() {
  const samples = [];
  for (let index = 0; index < 120; index++) {
    const label = index % 2;
    const offset = label === 1 ? 0.65 : 0.05;
    samples.push({ features: [Number((offset + (index % 11) * 0.02).toFixed(2)), Number((offset + (index % 7) * 0.03).toFixed(2))], label });
  }
  return {
    synthetic: true,
    description: "SYNTHETIC demo data for testing a binary classifier. It does not establish persuasion or real-world effectiveness.",
    featureNames: ["message_clarity", "offer_relevance"],
    samples,
  };
}
