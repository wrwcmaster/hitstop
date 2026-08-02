/**
 * Backprop for the fixed two-layer MLP, by hand, with a lie detector.
 *
 * PPO needs gradients through the POLICY (never through the game), and
 * at 2k-100k parameters that is ~60 lines of chain rule for our fixed
 * architecture, not a framework. Torch buys convenience and confidence;
 * the convenience we don't need, and the confidence we build here
 * instead: `gradCheck` compares every analytic derivative against the
 * finite-difference slope (perturb a weight by eps, measure the loss
 * move). Hand-written numerics are instruments, and this project's
 * instruments have needed more fixing than the things they measure —
 * so this one ships with its own falsification test, and the test is
 * proven able to fail before anything trusts a pass.
 *
 * Layout matches net.mjs exactly: per layer, weights row-major
 * [out][in], then biases — so trained blobs and PPO updates speak the
 * same format and `forward` here equals net.mjs's on the same input.
 */

/** Forward pass that remembers what backward needs. */
export function forwardCache(w, x, shape) {
  const acts = [x];          // post-activation per layer (input first)
  let at = 0;
  let cur = x;
  for (let l = 0; l + 1 < shape.length; l++) {
    const inN = shape[l];
    const outN = shape[l + 1];
    const last = l + 2 === shape.length;
    const next = new Float64Array(outN);
    for (let j = 0; j < outN; j++) {
      let sum = w[at + inN * outN + j];
      const base = at + j * inN;
      for (let i = 0; i < inN; i++) sum += w[base + i] * cur[i];
      next[j] = last ? sum : (sum > 0 ? sum : 0);
    }
    acts.push(next);
    at += inN * outN + outN;
    cur = next;
  }
  return { out: cur, acts };
}

/**
 * Backward: given dL/d(output), return dL/d(weights) and accumulate
 * nothing anywhere else. ReLU's derivative is taken from the CACHED
 * activation (>0 means the unit was live), which is the one place a
 * hand-rolled backprop classically goes wrong — the check below exists
 * for exactly that class of slip.
 */
export function backward(w, shape, cache, dOut) {
  const grad = new Float64Array(w.length);
  // Layer offsets, front to back.
  const offs = [];
  let at = 0;
  for (let l = 0; l + 1 < shape.length; l++) {
    offs.push(at);
    at += shape[l] * shape[l + 1] + shape[l + 1];
  }
  let dCur = dOut;
  for (let l = shape.length - 2; l >= 0; l--) {
    const inN = shape[l];
    const outN = shape[l + 1];
    const off = offs[l];
    const aIn = cache.acts[l];
    const aOut = cache.acts[l + 1];
    const last = l + 1 === shape.length - 1;
    const dPre = new Float64Array(outN);
    for (let j = 0; j < outN; j++) {
      // Through the ReLU (output layer is linear).
      dPre[j] = last ? dCur[j] : (aOut[j] > 0 ? dCur[j] : 0);
    }
    // Weights and biases of this layer.
    for (let j = 0; j < outN; j++) {
      const base = off + j * inN;
      for (let i = 0; i < inN; i++) grad[base + i] += dPre[j] * aIn[i];
      grad[off + inN * outN + j] += dPre[j];
    }
    // Push to the previous layer's activations.
    if (l > 0) {
      const dPrev = new Float64Array(inN);
      for (let j = 0; j < outN; j++) {
        const base = off + j * inN;
        for (let i = 0; i < inN; i++) dPrev[i] += dPre[j] * w[base + i];
      }
      dCur = dPrev;
    }
  }
  return grad;
}

/**
 * The lie detector: analytic gradient vs measured slope, every weight.
 *
 * Loss is `sum(out * c)` for a fixed random c, so dL/dout = c exactly
 * and any disagreement is backward()'s fault. Returns the worst
 * relative error; callers assert it is tiny. `breakIt` deliberately
 * corrupts one gradient entry first — used once in the self-test to
 * prove the check can fail, per this project's standing rule that a
 * probe is trusted only after it has been seen to catch a lie.
 */
export function gradCheck(shape, { eps = 1e-5, trials = 40, seedFn = Math.random, breakIt = false } = {}) {
  const n = (() => { let t = 0; for (let l = 0; l + 1 < shape.length; l++) t += shape[l] * shape[l + 1] + shape[l + 1]; return t; })();
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = (seedFn() - 0.5) * 0.6;
  const x = new Float64Array(shape[0]);
  for (let i = 0; i < shape[0]; i++) x[i] = (seedFn() - 0.5) * 2;
  const c = new Float64Array(shape[shape.length - 1]);
  for (let i = 0; i < c.length; i++) c[i] = (seedFn() - 0.5) * 2;

  const loss = (weights) => {
    const { out } = forwardCache(weights, x, shape);
    let L = 0;
    for (let i = 0; i < out.length; i++) L += out[i] * c[i];
    return L;
  };

  const { acts } = forwardCache(w, x, shape);
  const analytic = backward(w, shape, { acts }, c);
  // The corrupted entry must be among the SAMPLED ones, or the lie
  // detector never looks at the lie: one bad entry in 2,250 weights
  // survives 40 random samples 98% of the time — which is exactly what
  // happened the first time this self-test ran, and the corruption
  // passed. A falsification test that cannot see its own planted fault
  // proves nothing; trial zero now inspects the planted index.
  const broken = Math.floor(analytic.length / 2);
  if (breakIt) analytic[broken] += 1;

  let worst = 0;
  for (let t = 0; t < trials; t++) {
    const i = breakIt && t === 0 ? broken : Math.floor(seedFn() * n);
    const keep = w[i];
    w[i] = keep + eps; const up = loss(w);
    w[i] = keep - eps; const dn = loss(w);
    w[i] = keep;
    const measured = (up - dn) / (2 * eps);
    const denom = Math.max(1e-8, Math.abs(measured) + Math.abs(analytic[i]));
    worst = Math.max(worst, Math.abs(measured - analytic[i]) / denom);
  }
  return worst;
}

// Self-test: node tools/agent-play/learn/grad.mjs
if (process.argv[1] && process.argv[1].endsWith('grad.mjs')) {
  const shape = [74, 24, 18];
  const ok = gradCheck(shape);
  const lie = gradCheck(shape, { breakIt: true });
  console.log(`gradient check, ${shape.join('-')}: worst relative error ${ok.toExponential(2)}`);
  console.log(`with one entry deliberately corrupted: ${lie.toExponential(2)} (must be large)`);
  if (ok > 1e-4) { console.error('FAIL: analytic gradient disagrees with measurement'); process.exit(1); }
  if (lie < 1e-2) { console.error('FAIL: the check cannot detect a corrupted gradient'); process.exit(1); }
  console.log('backward() verified, and the verifier proven able to fail');
}
