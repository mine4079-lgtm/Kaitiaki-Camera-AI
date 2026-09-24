/*
 * Kaitiaki Next — isolated AI decision gate.
 *
 * The field app must never treat a confidence score as evidence of accuracy.
 * This module validates real model outputs but does not pretend to implement
 * inference, download weights, or change any existing Kaitiaki V4 model.
 *
 * No training, auto-accept or inference is enabled until a separately tested
 * model package supplies its model identifier, supported classes and scores.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.KaitiakiAIGate = api;
})(typeof globalThis === "object" ? globalThis : undefined, function () {
  "use strict";

  const TARGETS = Object.freeze(["Possum", "Rat", "Stoat", "Mouse", "Deer", "Pig", "Weka"]);
  const CLASSES = Object.freeze([...TARGETS, "Other wildlife", "Empty image"]);
  const OUTPUTS = Object.freeze(["Target candidate", "No target wildlife", "Empty image", "Human Review"]);
  const DEFAULT_GATE = Object.freeze({
    minTargetScore: 0.9,
    minNonTargetScore: 0.9,
    minTopMargin: 0.15,
    minTargetVsUnknownMargin: 0.2
  });

  function assertManifest(manifest) {
    if (!manifest || typeof manifest !== "object") throw new Error("Missing AI model manifest");
    if (!/^[a-z0-9][a-z0-9._-]{2,127}$/i.test(manifest.modelId || "")) throw new Error("Invalid model identifier");
    if (!Array.isArray(manifest.classes) || manifest.classes.length !== CLASSES.length ||
        CLASSES.some((name, index) => manifest.classes[index] !== name)) {
      throw new Error("Model class order mismatch; refusing to infer");
    }
    if (manifest.testedForFieldUse !== true) throw new Error("Model not marked as independently validated for field trial");
    if (typeof manifest.evaluationId !== "string" || manifest.evaluationId.trim().length < 3) {
      throw new Error("Missing independently validated evaluation reference");
    }
    if (!["tfjs-layers", "onnx"].includes(manifest.format)) throw new Error("Unsupported model format");
    return {modelId: manifest.modelId, evaluationId: manifest.evaluationId, format: manifest.format, classes: CLASSES.slice()};
  }

  function validateScores(scores) {
    if (!Array.isArray(scores) || scores.length !== CLASSES.length ||
        !scores.every(score => typeof score === "number" && Number.isFinite(score) && score >= 0 && score <= 1)) {
      throw new Error("Invalid AI probability vector");
    }
    const sum = scores.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > 0.015) throw new Error("AI scores must sum to 1");
    return scores;
  }

  function evaluate(scores, modelManifest, config) {
    const manifest = assertManifest(modelManifest);
    validateScores(scores);
    const gate = {...DEFAULT_GATE, ...(config || {})};
    for (const [key, value] of Object.entries(gate)) {
      if (!Object.prototype.hasOwnProperty.call(DEFAULT_GATE, key) ||
          !Number.isFinite(value) || value < 0 || value > 1) {
        throw new Error("Invalid AI gate setting");
      }
    }
    const sorted = scores.map((score, index) => ({label: CLASSES[index], score})).sort((a,b) => b.score - a.score);
    const top = sorted[0], second = sorted[1];
    const unknown = Math.max(scores[7], scores[8]);
    const topMargin = top.score - second.score;
    let disposition = "Human Review";
    if (topMargin >= gate.minTopMargin) {
      if (top.label === "Empty image" && top.score >= gate.minNonTargetScore) disposition = "Empty image";
      else if (top.label === "Other wildlife" && top.score >= gate.minNonTargetScore) disposition = "No target wildlife";
      else if (TARGETS.includes(top.label) && top.score >= gate.minTargetScore &&
               top.score - unknown >= gate.minTargetVsUnknownMargin) disposition = "Target candidate";
    }
    // Even a "Target candidate" remains an unverified prediction. Never update a
    // confirmed human label or use it as a training example.
    return Object.freeze({
      modelId: manifest.modelId,
      evaluationId: manifest.evaluationId,
      label: top.label,
      confidence: top.score,
      secondLabel: second.label,
      margin: topMargin,
      disposition,
      requiresHumanConfirmation: true,
      verified: false
    });
  }

  return Object.freeze({TARGETS, CLASSES, OUTPUTS, DEFAULT_GATE, assertManifest, validateScores, evaluate});
});