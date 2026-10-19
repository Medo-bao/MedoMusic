// Master gain + stereo balance + unified effect metric.
// The native references (tests/fxsound-*.cjs) cover the untouched chain; this
// file covers the two GraphicEq gain stages MedoMusic gained for 1.6.4.
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');

const core = require('../src/fxsound-core.js');

function loadSoundModule() {
  const source = require('node:fs').readFileSync(path.join(__dirname, '..', 'src', 'sound-enhancement.js'), 'utf8');
  const sandbox = { FxSoundCore: core, FxSoundCoreModule: core.FxSoundCoreModule, URL, Blob, WeakMap, console };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'sound-enhancement.js' });
  return sandbox.MedoSound;
}

const near = (actual, expected, tolerance, label) => {
  assert.ok(Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} +-${tolerance}, received ${actual}`);
};

// 1. dB -> linear conversion matches the native stage definition.
near(core.masterGain(0), 1, 0, 'masterGain(0 dB)');
near(core.masterGain(6), Math.pow(10, 6 / 20), 1e-7, 'masterGain(+6 dB)');
near(core.masterGain(-20), 0.1, 1e-7, 'masterGain(-20 dB)');
near(core.masterGain(20), 10, 1e-6, 'masterGain(+20 dB)');
near(core.masterGain(NaN), 1, 0, 'masterGain(invalid) is unity');

// 2. Native dB balance: attenuate one side and retain unity at center.
const endpoints = {
  '-20': core.balanceGain(-20),
  '0': core.balanceGain(0),
  '20': core.balanceGain(20)
};
near(endpoints['-20'].left, 1, 1e-7, 'balance(-20) left untouched');
near(endpoints['-20'].right, .1, 1e-7, 'balance(-20) right attenuated');
near(endpoints['20'].left, .1, 1e-7, 'balance(+20) left attenuated');
near(endpoints['20'].right, 1, 1e-7, 'balance(+20) right untouched');
assert.deepEqual(endpoints['0'], { left: 1, right: 1 }, 'balance(0) is unity');
for (const db of [-20, -13, -6, 4, 11, 20]) {
  const { left, right } = core.balanceGain(db);
  near(db < 0 ? left : right, 1, 0, `balance(${db}) keeps the favoured side at unity`);
  near(db < 0 ? right : left, Math.pow(10, -Math.abs(db) / 20), 1e-7, `balance(${db}) attenuates in dB`);
  assert.ok(left >= 0 && left <= 1 && right >= 0 && right <= 1, `balance(${db}) stays in [0,1]`);
}
assert.ok(core.balanceGain(-6).left > core.balanceGain(-6).right, 'negative balance favours the left side');
assert.ok(core.balanceGain(11).left < core.balanceGain(11).right, 'positive balance favours the right side');

// 3. Chain applies the trim after the EQ and before the effect stages.
const rate = 48000;
const settings = (overrides = {}) => ({
  bypass: false, ambience: 0, bass: 0, clarity: 0, dynamics: 1, surround: 0,
  clarityOn: 0, surroundOn: 0, bassOn: 0, masterGain: 0, balance: 0, ...overrides
});
const EQ_CENTERS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
function runChain(overrides) {
  const chain = new core.Chain(rate);
  EQ_CENTERS.forEach((hz, band) => chain.eq.setBand(band, hz, 0));
  const frames = 256;
  const input = [new Float32Array(frames), new Float32Array(frames)];
  // The native silence gate skips a group whose first frame is exactly zero,
  // so start on a non-zero phase like a live decoded block would.
  for (let i = 0; i < frames; i += 1) {
    input[0][i] = 0.1 * Math.sin(i * 0.05 + 0.7);
    input[1][i] = 0.1 * Math.sin(i * 0.05 + 1.1);
  }
  const output = [new Float32Array(frames), new Float32Array(frames)];
  chain.process(input, output, settings(overrides));
  // Skip the Maximizer lookahead window so the envelope/history settle.
  const start = 64;
  const rms = channel => {
    let sum = 0;
    for (let i = start; i < frames; i += 1) sum += output[channel][i] ** 2;
    return Math.sqrt(sum / (frames - start));
  };
  return { left: rms(0), right: rms(1) };
}
const reference = runChain({});
assert.ok(reference.left > 0.01 && reference.right > 0.01, 'reference chain output is audible');

const boosted = runChain({ masterGain: 6 });
near(boosted.right / reference.right, Math.pow(10, 6 / 20), 0.05, 'master gain +6 dB scales the output');

const attenuated = runChain({ masterGain: -12 });
near(attenuated.right / reference.right, Math.pow(10, -12 / 20), 0.03, 'master gain -12 dB scales the output');

const rightOnly = runChain({ balance: 20 });
assert.ok(rightOnly.right > 0.01, 'balance(+20) keeps the right channel audible');
near(rightOnly.left / reference.left, .1, 1e-6, 'balance(+20) attenuates the left channel by 20 dB');

const leftOnly = runChain({ balance: -20 });
assert.ok(leftOnly.left > 0.01, 'balance(-20) keeps the left channel audible');
near(leftOnly.right / reference.right, .1, 1e-6, 'balance(-20) attenuates the right channel by 20 dB');

const combined = runChain({ masterGain: 6, balance: -6 });
near(combined.right / reference.right, Math.pow(10, 6 / 20) * core.balanceGain(-6).right, 0.05,
  'master gain and balance compose');

// 4. Bypass stays an untouched passthrough regardless of the trim.
{
  const chain = new core.Chain(rate);
  const frames = 32;
  const input = [Float32Array.from({ length: frames }, (_, i) => 0.5 * Math.sin(i)), new Float32Array(frames)];
  const output = [new Float32Array(frames), new Float32Array(frames)];
  chain.process(input, output, settings({ bypass: true, masterGain: 20, balance: -20 }));
  for (let i = 0; i < frames; i += 1) assert.equal(output[0][i], input[0][i], 'bypass copies the left channel');
}

// 5. Unified effect metric: one shared 0-100 range, presets keep their percent.
const sound = loadSoundModule();
assert.deepEqual([...sound.EFFECT_KEYS], ['clarity', 'ambience', 'surround', 'dynamics', 'bass']);
assert.deepEqual({ ...sound.EFFECT_RANGE }, { min: 0, max: 100 });
assert.deepEqual({ ...sound.MASTER_GAIN_RANGE }, { min: -20, max: 20 });
assert.deepEqual({ ...sound.BALANCE_RANGE }, { min: -20, max: 20 });

const recommended = sound.normalize({ ...sound.presets.recommended, preset: 'recommended' });
assert.equal(recommended.clarity, 10, 'author clarity stays at 10%');
assert.equal(recommended.bass, 10, 'author bass is calibrated to the shared scale');
assert.equal(recommended.ambience, 18, 'author ambience unchanged');
assert.equal(recommended.surround, 13, 'author surround unchanged');
assert.equal(recommended.dynamics, 15, 'author dynamics unchanged');

const clamped = sound.normalize({ clarity: 999, ambience: -5, bass: 'x', masterGain: 99, balance: -99 });
assert.equal(clamped.clarity, 100, 'effect upper bound clamps');
assert.equal(clamped.ambience, 0, 'effect lower bound clamps');
assert.equal(clamped.bass, 0, 'non-numeric effect falls back to 0');
assert.equal(clamped.masterGain, 20, 'master gain clamps at +20 dB');
assert.equal(clamped.balance, -20, 'balance clamps at -20 dB');

for (const key of sound.EFFECT_KEYS) {
  const full = sound.normalize({ [key]: 100 });
  const half = sound.normalize({ [key]: 50 });
  assert.equal(full[key], 100, `${key} keeps 100 percent`);
  assert.equal(half[key], 50, `${key} keeps 50 percent`);
}
assert.equal(sound.presets.flat.masterGain, 0, 'flat preset neutralises master gain');
assert.equal(sound.presets.flat.balance, 0, 'flat preset neutralises balance');

// 6. Worklet descriptors expose both new k-rate parameters with the documented range.
{
  const processors = {};
  const sandbox = {
    sampleRate: 48000,
    AudioWorkletProcessor: class { constructor() { this.port = {}; } },
    registerProcessor: (name, ctor) => { processors[name] = ctor; },
    console, URL, Blob, WeakMap, Float32Array, Math, Object, Array, Number
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(require('node:fs').readFileSync(path.join(__dirname, '..', 'src', 'fxsound-core.js'), 'utf8'), sandbox, { filename: 'fxsound-core.worklet.js' });
  const descriptors = processors['fxsound-chain'].parameterDescriptors;
  const byName = new Map(descriptors.map(item => [item.name, item]));
  for (const name of ['masterGain', 'balance']) {
    const descriptor = byName.get(name);
    assert.ok(descriptor, `${name} descriptor exists`);
    assert.equal(descriptor.defaultValue, 0, `${name} defaults to 0 dB`);
    assert.equal(descriptor.minValue, -20, `${name} floor is -20 dB`);
    assert.equal(descriptor.maxValue, 20, `${name} ceiling is +20 dB`);
    assert.equal(descriptor.automationRate, 'k-rate', `${name} is k-rate`);
  }
  // 20 band descriptors + 9 effect controls + 2 trims + 2 loudness controls.
  assert.equal(byName.size, 33, 'all band, effect, trim and loudness descriptors are present');
}

console.log('Master gain, balance and effect metrics passed');



