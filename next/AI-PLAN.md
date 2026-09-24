# Kaitiaki Next — AI phase 1 (isolated)

This folder builds the **new app**; it deliberately does not reuse or overwrite the trained production V4. The Scan/Results/Learning interface is already functional. No new AI is currently installed, and the interface must not show fabricated species or confidence.

## New AI contract

`ai-gate.js` validates a separately trained model's manifest and probabilities, with fixed class order:
Possum, Rat, Stoat, Mouse, Deer, Pig, Weka, Other wildlife, Empty image.

It returns a *candidate* or a *Human Review* disposition, and **always requires human confirmation**. It never writes into verified labels, exports a training claim, or replaces a deployed model.

A future real model must:
1. Train on confirmed records only, with duplicate bursts and matching camera/site periods kept out of held-out evaluation.
2. Include independently verified Other wildlife and empty-camera images; unknown species must not be forced into the seven target labels.
3. Be evaluated separately on day/night and multiple cameras, especially rat–possum and deer–possum confusion, and genuine non-target images.
4. Produce a class-ordered calibrated probability vector and an independently validated evaluation report before packaging.
5. Have its own frozen package and model ID, separate from old V4; only after field validation can its gate be made available in the normal Results UI.
6. Stay usable offline once model artifacts are explicitly downloaded and verified on the device.

The threshold constants are **provisional safety defaults, not demonstrated field performance**. High softmax confidence alone is not proof of correctness or open-set rejection. This phase does not introduce continuous live self-training or automatically accept predictions.

Run `node next/ai-gate.test.cjs` to check the decision contract.
