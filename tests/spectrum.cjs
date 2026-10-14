const assert = require('node:assert/strict');
const spectrum = require('../src/spectrum.js');

const near = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${label}: expected ${expected} ± ${tolerance}, got ${actual}`
);
const flux = profile => profile.intensity.reduce((sum, value) => sum + value, 0) * profile.stepMm;
const coordinate = (profile, index) => (index + 0.5) * profile.stepMm - profile.widthMm / 2;
function peak(profile, low, high) {
  let best = -1;
  for (let i = 0; i < profile.samples; i++) {
    const x = coordinate(profile, i);
    if (x >= low && x <= high && (best < 0 || profile.intensity[i] > profile.intensity[best])) best = i;
  }
  assert.notEqual(best, -1);
  return coordinate(profile, best);
}
function colour(profile, low, high) {
  const total = [0, 0, 0];
  for (let i = 0; i < profile.samples; i++) {
    if (coordinate(profile, i) < low || coordinate(profile, i) > high) continue;
    for (let channel = 0; channel < 3; channel++) total[channel] += profile.rgb[i * 3 + channel];
  }
  return total;
}

const base = { distanceMm: 315, samples: 4096, widthMm: 270 };
const white = spectrum.profile(base);
const red = spectrum.profile({ ...base, filter: 'red' });
const blue = spectrum.profile({ ...base, filter: 'blue' });
const narrow = spectrum.profile({ ...base, filter: 'red', apertureMm: 2 });

near(spectrum.orderPositionMm(650, 1, 315), 20.5184, 0.001, 'Red first-order geometry');
near(spectrum.orderPositionMm(650, 2, 315), 41.3005, 0.001, 'Red second-order geometry');
near(spectrum.orderPositionMm(465, 1, 315), 14.6634, 0.001, 'Blue first-order geometry');
for (const [profile, wavelength, name] of [[red, 650, 'red'], [blue, 465, 'blue']]) {
  for (const order of [1, 2]) {
    const expected = spectrum.orderPositionMm(wavelength, order, 315);
    near(peak(profile, expected - 2, expected + 2), expected, 0.2, `${name} order ${order} peak`);
    near(peak(profile, -expected - 2, -expected + 2), -expected, 0.2, `${name} negative order ${order} peak`);
  }
}
near(peak(narrow, 19, 22), peak(red, 19, 22), 0.07, 'Aperture must not shift the red maximum');
near(flux(narrow) / flux(red), (2 / 18) ** 2, 0.00005, 'Collected flux follows aperture area');
assert.ok(spectrum.blurSigmaMm(650, 755, 2) > spectrum.blurSigmaMm(650, 755, 18), 'A smaller aperture broadens each wavelength');

for (const [profile, dominant, name, first] of [[red, 0, 'red', 20.5], [blue, 2, 'blue', 14.66]]) {
  for (const centre of [0, first, first * 2]) {
    const channels = colour(profile, centre - 2, centre + 2);
    for (let channel = 0; channel < 3; channel++) {
      if (channel !== dominant) assert.ok(channels[dominant] > channels[channel] * 1.5, `${name} filter colours order around ${centre} mm`);
    }
  }
  assert.ok(flux(profile) < flux(white), `${name} filter reduces the total light`);
}
const centreWhite = colour(white, -2, 2);
assert.ok(centreWhite[0] > centreWhite[2] && centreWhite[1] > centreWhite[2], 'Unfiltered zero order has a warm white mix');
assert.ok(white.orders.includes(4) && white.orders.includes(-4), 'Do not stop at order three when more orders fit');

const coarse = spectrum.profile({ ...base, samples: 1080 });
const fine = spectrum.profile({ ...base, samples: 2160 });
near(flux(coarse), flux(fine), flux(fine) * 0.001, 'Pixel size must not change collected light');
let worstError = 0;
let brightest = 0;
for (let i = 0; i < coarse.samples; i++) {
  for (let channel = 0; channel < 3; channel++) {
    const averaged = (fine.rgb[i * 6 + channel] + fine.rgb[i * 6 + 3 + channel]) / 2;
    worstError = Math.max(worstError, Math.abs(coarse.rgb[i * 3 + channel] - averaged));
    brightest = Math.max(brightest, averaged);
  }
}
assert.ok(worstError / brightest < 0.02, 'Continuous light profile is stable when pixel resolution doubles');

const off = spectrum.profile({ ...base, light: false });
assert.ok(off.rgb.every(value => value === 0) && off.intensity.every(value => value === 0), 'Source off means no spectrum or central light');
assert.deepEqual(off.orders, []);
for (const options of [base, { distanceMm: 1, apertureMm: 2 }, { distanceMm: 5000, apertureMm: 20 },
  { distanceMm: NaN, samples: Infinity, widthMm: -10, apertureMm: NaN }, { samples: 2, widthMm: 2000 }]) {
  const result = spectrum.profile(options);
  assert.equal(result.rgb.length, result.samples * 3);
  assert.equal(result.intensity.length, result.samples);
  assert.ok(result.rgb.every(value => Number.isFinite(value) && value >= 0));
  assert.ok(result.intensity.every(value => Number.isFinite(value) && value >= 0));
}
assert.equal(spectrum.orderPositionMm(650, 20, 315), null, 'An evanescent order is not placed on the screen');
assert.equal(spectrum.toDisplay(0), 0);
assert.equal(spectrum.toDisplay(-1), 0);
assert.ok(spectrum.toDisplay(0.1) < spectrum.toDisplay(0.5));
assert.equal(spectrum.toDisplay(1000), 255);
const centreIndex = Math.floor(blue.samples / 2) * 3;
const blueDisplay = spectrum.displayRgb(...blue.rgb.slice(centreIndex, centreIndex + 3));
assert.ok(blueDisplay[2] > blueDisplay[1] * 1.4, 'Exposure must preserve a visibly blue centre');
const whiteDisplay = spectrum.displayRgb(...white.rgb.slice(centreIndex, centreIndex + 3));
assert.ok(whiteDisplay[0] > whiteDisplay[1] && whiteDisplay[1] > whiteDisplay[2], 'Exposure preserves the warm unfiltered centre');
assert.deepEqual(spectrum.displayRgb(0, 0, 0), [0, 0, 0]);
assert.ok(spectrum.displayRgb(0.1, 0.05, 0)[0] < spectrum.displayRgb(1, 0.5, 0)[0], 'Common exposure does not normalize away dimming');
console.log('Spectrum: geometry, smooth sampling, aperture, all-order filters and finite values passed.');
