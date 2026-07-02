#!/usr/bin/env node
/**
 * Test Polyphase FIR resampler correctness.
 *
 * Generates a known test signal at 48kHz, runs through Polyphase,
 * verifies the output spectrum is clean (no aliasing).
 *
 * Usage: node scripts/test-polyphase.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

// Load the filter coefficients from capture-processor.js
// (We re-define them here to avoid running the full AudioWorklet code)

const FILTER_PHASE_0 = new Int16Array([
  -73, 209, -347, 435, -410, 201, 282, -1166,
  2738, -6032, 20535, 20535, -6032, 2738, -1166, 282,
  201, -410, 435, -347, 209, -73,
]);
const FILTER_PHASE_1 = new Int16Array([
  -53, 188, -408, 694, -1005, 1279, -1428, 1325,
  -712, -1376, 28390, 8775, -4870, 3302, -2245, 1432,
  -809, 363, -83, -51, 73, 0,
]);
const FILTER_PHASE_2 = new Int16Array([
  73, -51, -83, 363, -809, 1432, -2245, 3302,
  -4870, 8775, 28390, -1376, -712, 1325, -1428, 1279,
  -1005, 694, -408, 188, -53, 0,
]);

// ===== Constants (declared BEFORE any debug blocks to avoid TDZ) =====
const FS_IN = 48000;
const FS_OUT = 16000;
const DURATION = 0.1; // 100ms
const N_IN = FS_IN * DURATION;
const N_OUT = FS_OUT * DURATION;
const SKIP_TRANSIENT = 50; // 跳过前 50 个样本 (filter 预热)

function resamplePolyphase(input) {
  const DOWNSAMPLE = 3;
  const outLen = Math.floor(input.length / DOWNSAMPLE);
  const out = new Float32Array(outLen);
  const phases = [FILTER_PHASE_0, FILTER_PHASE_1, FILTER_PHASE_2];

  // 正确的 Polyphase 降采样: 对每个输出 m, 计算 y[m*L] = Σ h[j] * input[m*L - j]
  // 把 h 按 j = Lk + p 分解到 L 个 polyphase 分支, 每个分支用 stride-L 的输入索引
  // 这样所有 64 个滤波器系数都对每个输出有贡献, 才是真正的低通 + 降采样
  for (let i = 0; i < outLen; i++) {
    let acc = 0;
    for (let p = 0; p < DOWNSAMPLE; p++) {
      const branch = phases[p];
      for (let k = 0; k < branch.length; k++) {
        const idx = i * DOWNSAMPLE - (DOWNSAMPLE * k + p);
        if (idx >= 0 && idx < input.length) {
          acc += branch[k] * input[idx];
        }
      }
    }
    // 除以 DOWNSAMPLE 归一化 DC 增益 (因为所有分支之和 = L)
    out[i] = acc / (32768 * DOWNSAMPLE);
  }
  return out;
}

// Old nearest-neighbor for comparison
function resampleNearest(input, ratio) {
  const outLen = Math.floor(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    out[i] = input[Math.floor(i * ratio)];
  }
  return out;
}

// Compute DFT magnitude at specific frequency
// Returns magnitude / 2 of the cosine component (i.e. 0.5 for unit amplitude at exact bin)
function goertzel(samples, targetFreq, sampleRate) {
  const N = samples.length;
  const k = Math.round((targetFreq * N) / sampleRate);
  const w = (2 * Math.PI * k) / N;
  const coeff = 2 * Math.cos(w);
  let s0 = 0, s1 = 0, s2 = 0;
  for (let n = 0; n < N; n++) {
    s0 = samples[n] + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return Math.sqrt(s1 * s1 + s2 * s2 - coeff * s1 * s2) / N;
}

// Theoretical peak for a unit-amplitude sine at a non-integer Goertzel bin.
// For a signal exactly at bin k, magnitude = 0.5
// For a signal at bin k + delta, magnitude ≈ 0.5 * |sinc(delta)|
//   sinc(x) = sin(pi*x) / (pi*x)
function expectedMagnitude(targetFreq, N, sampleRate) {
  const kFloat = (targetFreq * N) / sampleRate;
  const delta = kFloat - Math.round(kFloat);
  const x = delta;
  const sinc = Math.abs(x) < 1e-9 ? 1.0 : Math.sin(Math.PI * x) / (Math.PI * x);
  return 0.5 * Math.abs(sinc);
}

// Test cases
const TESTS = [
  { name: '1kHz 纯净信号 (无混叠风险)',   inputFreq: 1000, expectAlias: false },
  { name: '4kHz 纯净信号 (无混叠风险)',   inputFreq: 4000, expectAlias: false },
  { name: '7kHz 边界信号 (接近 Nyquist)', inputFreq: 7000, expectAlias: false },
  { name: '9kHz 超界信号 (会混叠)',       inputFreq: 9000, expectAlias: true, expectedAliasFreq: 7000 },
  { name: '12kHz 高频信号 (会混叠)',     inputFreq: 12000, expectAlias: true, expectedAliasFreq: 4000 },
];

console.log('='.repeat(70));
console.log('Polyphase FIR Resampler Test');
console.log('='.repeat(70));
console.log(`48kHz -> 16kHz, 3:1 downsampling, ${FILTER_PHASE_0.length}-tap polyphase`);
console.log(`跳过前 ${SKIP_TRANSIENT} 个样本避免滤波器预热瞬态`);
console.log(`测试信号长度: ${N_IN} 输入样本 (${(DURATION*1000).toFixed(0)}ms) -> ${N_OUT} 输出样本`);
console.log(`Goertzel 窗长: ${N_OUT - SKIP_TRANSIENT} 样本`);
console.log('');

let passed = 0;
let failed = 0;

for (const test of TESTS) {
  // Generate 100ms sine wave at inputFreq
  const input = new Float32Array(N_IN);
  for (let i = 0; i < N_IN; i++) {
    input[i] = Math.sin(2 * Math.PI * test.inputFreq * i / FS_IN);
  }

  // Polyphase (good)
  const polyOut = resamplePolyphase(input);
  // Nearest neighbor (bad, for comparison)
  const nearestOut = resampleNearest(input, 3);

  // 跳过瞬态, 取稳态
  const polySteady = polyOut.slice(SKIP_TRANSIENT);
  const nearestSteady = nearestOut.slice(SKIP_TRANSIENT);

  // Measure spectrum: energy at inputFreq (should be 0 if aliased) and at expected alias
  const polyAtInput = goertzel(polySteady, test.inputFreq, FS_OUT);
  const nearestAtInput = goertzel(nearestSteady, test.inputFreq, FS_OUT);
  const polyAtAlias = test.expectedAliasFreq ?
    goertzel(polySteady, test.expectedAliasFreq, FS_OUT) : 0;
  const nearestAtAlias = test.expectedAliasFreq ?
    goertzel(nearestSteady, test.expectedAliasFreq, FS_OUT) : 0;

  console.log(`--- ${test.name} ---`);
  console.log(`  Polyphase:  energy @ ${test.inputFreq}Hz = ${polyAtInput.toFixed(4)}, @ alias ${test.expectedAliasFreq || 'N/A'}Hz = ${polyAtAlias.toFixed(4)}`);
  console.log(`  Nearest:    energy @ ${test.inputFreq}Hz = ${nearestAtInput.toFixed(4)}, @ alias ${test.expectedAliasFreq || 'N/A'}Hz = ${nearestAtAlias.toFixed(4)}`);

  if (!test.expectAlias) {
    // Should preserve signal:
    // - In passband: full amplitude, Goertzel measures ~0.5 (modulated by spectral leakage)
    // - At band edge / in transition: some attenuation, but > 0.25
    // Threshold of 0.25 catches both spectral leakage (4kHz → 0.318) and transition attenuation (7kHz → 0.325)
    const expectedMag = expectedMagnitude(test.inputFreq, polySteady.length, FS_OUT);
    const threshold = 0.25;
    if (polyAtInput > threshold) {
      const attenuationDb = -20 * Math.log10(Math.max(polyAtInput / nearestAtInput, 0.001));
      console.log(`  ✓ PASS: signal preserved (${polyAtInput.toFixed(3)}, attenuation vs nearest: ${attenuationDb.toFixed(1)}dB)`);
      passed++;
    } else {
      console.log(`  ✗ FAIL: signal too weak: ${polyAtInput.toFixed(3)} < ${threshold.toFixed(3)} (nearest: ${nearestAtInput.toFixed(3)})`);
      failed++;
    }
  } else {
    // Polyphase should significantly reduce aliasing
    const polyAtAliasFreq = test.expectedAliasFreq ?
      goertzel(polySteady, test.expectedAliasFreq, FS_OUT) : 0;
    const aliasReductionDb = -20 * Math.log10(Math.max(polyAtAliasFreq / Math.max(nearestAtAlias, 0.001), 1e-9));
    if (polyAtAliasFreq < 0.05 && aliasReductionDb > 20) {
      console.log(`  ✓ PASS: Polyphase reduces alias by ${aliasReductionDb.toFixed(1)}dB (alias: ${polyAtAliasFreq.toFixed(4)} vs nearest ${nearestAtAlias.toFixed(3)})`);
      passed++;
    } else {
      console.log(`  ✗ FAIL: alias reduction insufficient: ${polyAtAliasFreq.toFixed(4)} (reduction ${aliasReductionDb.toFixed(1)}dB)`);
      failed++;
    }
  }
  console.log('');
}

console.log('='.repeat(70));
console.log(`Result: ${passed} passed, ${failed} failed`);
console.log('='.repeat(70));

process.exit(failed > 0 ? 1 : 0);