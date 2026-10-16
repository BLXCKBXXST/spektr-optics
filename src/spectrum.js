/*
 * One horizontal light profile shared by every view of the screen.
 * Positions use d sin(theta) = m lambda and y = D tan(theta), normal incidence:
 * https://www.newport.com.cn/n/the-grating-equation
 *
 * The source spectrum, filter passbands, order efficiencies and source blur are
 * provisional display approximations, not measurements of the real equipment.
 * A Gaussian approximates a far-field central lobe (FWHM about 1.03 lambda D /
 * diameter). This is an effective linewidth, not a full Fresnel propagation or
 * lens model, and does not reproduce Airy rings or aperture-edge fringes.
 */
const SpektrSpectrum = (() => {
  'use strict';

  const GRATING_PERIOD_MM = 0.01;
  const MIN_APERTURE_MM = 10;
  const MAX_APERTURE_MM = 20;
  const DEFAULT_APERTURE_MM = 18;
  const MIN_WAVELENGTH_NM = 380;
  const MAX_WAVELENGTH_NM = 740;
  const SOURCE_SIGMA_MM = 0.3;
  const SQRT_TWO_PI = Math.sqrt(2 * Math.PI);
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const smooth = value => {
    const t = clamp(value, 0, 1);
    return t * t * (3 - 2 * t);
  };

  function wavelengthRgb(wavelengthNm) {
    const w = wavelengthNm;
    let r = 0, g = 0, b = 0;
    if (w < 440) { r = 1 - smooth((w - 380) / 60); b = 1; }
    else if (w < 490) { g = smooth((w - 440) / 50); b = 1; }
    else if (w < 510) { g = 1; b = 1 - smooth((w - 490) / 20); }
    else if (w < 580) { r = smooth((w - 510) / 70); g = 1; }
    else if (w < 645) { r = 1; g = 1 - smooth((w - 580) / 65); }
    else { r = 1; }
    const visible = smooth((w - 380) / 40) * (1 - smooth((w - 685) / 55));
    // The colour ramps describe display primaries; decode them before adding
    // light. Otherwise the blue-green transition becomes an overly pale cyan.
    return [r ** 2.2 * visible, g ** 2.2 * visible, b ** 2.2 * visible];
  }

  function transmission(wavelengthNm, filter) {
    if (filter === 'red') return Math.exp(-0.5 * ((wavelengthNm - 650) / 22) ** 2);
    if (filter === 'green') return Math.exp(-0.5 * ((wavelengthNm - 550) / 22) ** 2);
    if (filter === 'blue') return Math.exp(-0.5 * ((wavelengthNm - 465) / 21) ** 2);
    return 1;
  }

  function orderPositionMm(wavelengthNm, order, distanceMm) {
    const sine = order * wavelengthNm * 1e-6 / GRATING_PERIOD_MM;
    if (!Number.isFinite(sine) || !Number.isFinite(distanceMm) || Math.abs(sine) >= 1) return null;
    return distanceMm * sine / Math.sqrt(1 - sine * sine);
  }

  function blurSigmaMm(wavelengthNm, distanceMm, apertureMm) {
    const aperture = clamp(finite(apertureMm, DEFAULT_APERTURE_MM), MIN_APERTURE_MM, MAX_APERTURE_MM);
    const diffractionSigma = 0.437 * wavelengthNm * 1e-6 * Math.max(0, distanceMm) / aperture;
    return Math.hypot(SOURCE_SIGMA_MM, diffractionSigma);
  }

  // All wavelengths, including those forming the zero order, pass through the
  // same filter. Never recolour the zero order independently of the spectrum.
  const wavelengths = [];
  let sourceWeight = 0;
  for (let w = MIN_WAVELENGTH_NM; w <= MAX_WAVELENGTH_NM; w += 1) {
    const source = 0.65 + 0.35 * (w - MIN_WAVELENGTH_NM) / (MAX_WAVELENGTH_NM - MIN_WAVELENGTH_NM);
    wavelengths.push({ wavelength: w, rgb: wavelengthRgb(w), source });
    sourceWeight += source;
  }

  function profile(options = {}) {
    const distanceMm = clamp(finite(options.distanceMm, 605), 1, 5000);
    const apertureMm = clamp(finite(options.apertureMm, DEFAULT_APERTURE_MM), MIN_APERTURE_MM, MAX_APERTURE_MM);
    const filter = ['red', 'green', 'blue'].includes(options.filter) ? options.filter : 'none';
    const widthMm = clamp(finite(options.widthMm, 270), 1, 2000);
    const samples = clamp(Math.round(finite(options.samples, 1080)), 2, 8192);
    const stepMm = widthMm / samples;
    const rgb = new Float32Array(samples * 3);
    const intensity = new Float32Array(samples);
    const orders = new Set();
    const result = { rgb, intensity, samples, widthMm, stepMm, distanceMm, apertureMm, filter, orders: [] };
    if (options.light === false) return result;

    const halfWidth = widthMm / 2;
    const area = (apertureMm / DEFAULT_APERTURE_MM) ** 2;
    // Brightness stays on one common scale: do not normalize each frame by its
    // brightest pixel, because that would hide the aperture/filter attenuation.
    const flux = 14 * area / sourceWeight;
    const visibleSine = (halfWidth + 8) / Math.hypot(distanceMm, halfWidth + 8);
    const maxOrder = Math.min(
      Math.floor(GRATING_PERIOD_MM / (MIN_WAVELENGTH_NM * 1e-6)),
      Math.ceil(visibleSine * GRATING_PERIOD_MM / (MIN_WAVELENGTH_NM * 1e-6))
    );

    function addLine(position, sigma, colour, weight) {
      // Include one pixel's integration width; a subpixel line must not flicker
      // or disappear when the screen moves between two sampled coordinates.
      const sampledSigma = Math.hypot(sigma, stepMm / Math.sqrt(12));
      const extent = sampledSigma * 4.5;
      if (position - extent > halfWidth || position + extent < -halfWidth) return false;
      const first = Math.max(0, Math.floor((position - extent + halfWidth) / stepMm));
      const last = Math.min(samples - 1, Math.ceil((position + extent + halfWidth) / stepMm));
      const density = weight / (SQRT_TWO_PI * sampledSigma);
      for (let i = first; i <= last; i++) {
        const coordinate = (i + 0.5) * stepMm - halfWidth;
        const light = density * Math.exp(-0.5 * ((coordinate - position) / sampledSigma) ** 2);
        const base = i * 3;
        rgb[base] += light * colour[0];
        rgb[base + 1] += light * colour[1];
        rgb[base + 2] += light * colour[2];
        intensity[i] += light;
      }
      return true;
    }

    for (const { wavelength, rgb: colour, source } of wavelengths) {
      const weight = flux * source * transmission(wavelength, filter);
      if (weight < 1e-9 || colour[0] + colour[1] + colour[2] < 1e-6) continue;
      const sigma = blurSigmaMm(wavelength, distanceMm, apertureMm);
      if (addLine(0, sigma, colour, weight)) orders.add(0);
      for (let m = 1; m <= maxOrder; m++) {
        const position = orderPositionMm(wavelength, m, distanceMm);
        if (position === null) break;
        const efficiency = 1 / (1 + (m / 1.1) ** 2);
        // At oblique angles the diffraction peak is stretched across the flat
        // screen. The finite-aperture term alone receives that projection.
        const cosine = distanceMm / Math.hypot(distanceMm, position);
        const diffractionSigma = 0.437 * wavelength * 1e-6 * distanceMm / apertureMm / cosine ** 3;
        const orderSigma = Math.hypot(SOURCE_SIGMA_MM, diffractionSigma);
        if (addLine(position, orderSigma, colour, weight * efficiency)) orders.add(m);
        if (addLine(-position, orderSigma, colour, weight * efficiency)) orders.add(-m);
      }
    }
    result.orders = [...orders].sort((a, b) => a - b);
    return result;
  }

  function toDisplay(linearValue, exposure = 2.4) {
    const light = Math.max(0, finite(linearValue, 0));
    const mapped = 1 - Math.exp(-light * Math.max(0, finite(exposure, 2.4)));
    // Standard sRGB transfer after a smooth exposure curve, without hard RGB
    // clipping that would wash overlapping orders into rectangular white bands.
    const srgb = mapped <= 0.0031308 ? 12.92 * mapped : 1.055 * mapped ** (1 / 2.4) - 0.055;
    return clamp(Math.round(255 * srgb), 0, 255);
  }

  function displayRgb(red, green, blue, exposure = 2.4) {
    const channels = [red, green, blue].map(value => Math.max(0, finite(value, 0)));
    const peak = Math.max(...channels);
    if (peak === 0) return [0, 0, 0];
    const scale = (1 - Math.exp(-peak * Math.max(0, finite(exposure, 2.4)))) / peak;
    // One exposure curve for the whole colour preserves the filter hue and the
    // warm unfiltered centre, instead of clipping each primary independently.
    return channels.map(value => {
      const linear = value * scale;
      const srgb = linear <= 0.0031308 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
      return clamp(Math.round(255 * srgb), 0, 255);
    });
  }

  function screenStrip(lightProfile) {
    const pixels = new Uint8ClampedArray(lightProfile.samples * 4);
    for (let i = 0; i < lightProfile.samples; i++) {
      const source = i * 3, target = i * 4;
      const channels = [0, 1, 2].map(channel => Math.max(0, finite(lightProfile.rgb[source + channel], 0)));
      const peak = Math.max(...channels);
      if (peak === 0) continue;
      const hue = displayRgb(...channels.map(value => value / peak), 8);
      // A restrained, paper-like palette instead of fully saturated primaries.
      // This is display styling only; the linear light profile stays untouched.
      for (let channel = 0; channel < 3; channel++) {
        pixels[target + channel] = Math.round(218 + (hue[channel] - 218) * 0.62);
      }
      // One common curve reduces bright-band contrast, while its soft toe keeps
      // faint higher orders visible. No per-frame normalization or light floor:
      // narrowing the aperture still dims the picture and zero light is clear.
      const exposed = -Math.expm1(-peak * 3.2);
      pixels[target + 3] = Math.round(255 * 0.72 * exposed ** 0.8);
    }
    return pixels;
  }

  return Object.freeze({ profile, toDisplay, displayRgb, screenStrip, transmission, orderPositionMm, blurSigmaMm,
    GRATING_PERIOD_MM, MIN_APERTURE_MM, MAX_APERTURE_MM, DEFAULT_APERTURE_MM });
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SpektrSpectrum;
