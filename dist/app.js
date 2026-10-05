import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const LINES = {
  red: { name: 'Красная', wavelength: 680, color: '#ff4545', rgb: [255, 46, 36] },
  green: { name: 'Зелёная', wavelength: 530, color: '#4dff82', rgb: [45, 255, 92] },
  blue: { name: 'Синяя', wavelength: 465, color: '#4d78ff', rgb: [55, 92, 255] }
};

const state = {
  power: false,
  distanceCm: 50,
  linesPerMm: 100,
  order: 1,
  target: 'green',
  cursorMm: 0,
  measurements: JSON.parse(localStorage.getItem('lab73-measurements') || '[]')
};

const $ = (id) => document.getElementById(id);
const format = (value, digits = 1) => value.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function maximumPositionMm(wavelengthNm, linesPerMm, order, distanceCm) {
  const d = 1 / (linesPerMm * 1000);
  const lambda = wavelengthNm * 1e-9;
  const ratio = order * lambda / d;
  if (Math.abs(ratio) > 1) return null;
  return distanceCm * 10 * Math.tan(Math.asin(ratio));
}

function calculatedWavelengthNm(xMm, distanceCm, linesPerMm, order) {
  const x = Math.abs(xMm) / 1000;
  const D = distanceCm / 100;
  const d = 1 / (linesPerMm * 1000);
  return d * (x / Math.sqrt(D * D + x * x)) / order * 1e9;
}

let scene, camera, renderer, controls, screenMesh, screenTexture, beam, lightGlow;
let fallbackCanvas = null;

function initScene() {
  const host = $('scene');
  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x090d13, 5.8, 10.5);
  camera = new THREE.PerspectiveCamera(38, host.clientWidth / host.clientHeight, 0.1, 100);
  camera.position.set(5.8, 3.5, 5.7);
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  host.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0.65, 0);
  controls.enableDamping = true;
  controls.minDistance = 3.5;
  controls.maxDistance = 11;
  controls.maxPolarAngle = Math.PI * .48;

  scene.add(new THREE.HemisphereLight(0x8aa6cf, 0x15100b, 1.45));
  const key = new THREE.DirectionalLight(0xdbeaff, 3.2);
  key.position.set(-2, 6, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  scene.add(key);
  const rim = new THREE.PointLight(0x2a8cff, 16, 8);
  rim.position.set(2, 2, -3);
  scene.add(rim);

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 10), new THREE.MeshStandardMaterial({ color: 0x080c12, roughness: .93 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const table = new THREE.Mesh(new THREE.BoxGeometry(7.5, .22, 2.35), new THREE.MeshStandardMaterial({ color: 0x27313d, roughness: .55, metalness: .35 }));
  table.position.y = .42;
  table.castShadow = table.receiveShadow = true;
  scene.add(table);
  [-3.25, 3.25].forEach(x => [-.85, .85].forEach(z => {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(.18, .8, .18), new THREE.MeshStandardMaterial({ color: 0x161d26, metalness: .7, roughness: .3 }));
    leg.position.set(x, 0, z); leg.castShadow = true; scene.add(leg);
  }));

  const railMat = new THREE.MeshStandardMaterial({ color: 0x8a95a1, metalness: .86, roughness: .2 });
  [-.19, .19].forEach(z => {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, 6.6, 20), railMat);
    rail.rotation.z = Math.PI / 2; rail.position.set(0, .67, z); rail.castShadow = true; scene.add(rail);
  });

  addSource(-2.65);
  addGrating(-.55);
  addScreen(2.45);

  const beamGeo = new THREE.CylinderGeometry(.018, .018, 2.06, 12);
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffe6ae, transparent: true, opacity: 0, blending: THREE.AdditiveBlending });
  beam = new THREE.Mesh(beamGeo, beamMat);
  beam.rotation.z = -Math.PI / 2; beam.position.set(-1.6, 1.05, 0); scene.add(beam);

  window.addEventListener('resize', resizeScene);
  renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
}

function baseStand(x) {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0x303b48, roughness: .33, metalness: .75 });
  const foot = new THREE.Mesh(new THREE.BoxGeometry(.55, .12, .72), metal); foot.position.y = .68; foot.castShadow = true; group.add(foot);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(.045, .055, 1.05, 20), metal); pole.position.y = 1.17; pole.castShadow = true; group.add(pole);
  group.position.x = x; scene.add(group); return group;
}

function addSource(x) {
  const stand = baseStand(x);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(.22, .26, .55, 28), new THREE.MeshStandardMaterial({ color: 0x202a35, roughness: .3, metalness: .72 }));
  body.rotation.z = Math.PI / 2; body.position.y = .38; body.castShadow = true; stand.add(body);
  lightGlow = new THREE.Mesh(new THREE.CircleGeometry(.16, 32), new THREE.MeshBasicMaterial({ color: 0xffd079, transparent: true, opacity: .06, side: THREE.DoubleSide }));
  lightGlow.rotation.y = Math.PI / 2; lightGlow.position.set(.285, .38, 0); stand.add(lightGlow);
  const hood = new THREE.Mesh(new THREE.CylinderGeometry(.34, .2, .4, 28, 1, true), new THREE.MeshStandardMaterial({ color: 0x2c3744, roughness: .3, metalness: .7, side: THREE.DoubleSide }));
  hood.rotation.z = Math.PI / 2; hood.position.set(.42, .38, 0); stand.add(hood);
}

function addGrating(x) {
  const stand = baseStand(x);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(.08, .66, .62), new THREE.MeshStandardMaterial({ color: 0x181f28, metalness: .6, roughness: .32 }));
  frame.position.y = .38; frame.castShadow = true; stand.add(frame);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(.045, .46, .42), new THREE.MeshPhysicalMaterial({ color: 0x88dcff, transmission: .56, opacity: .7, transparent: true, roughness: .12, metalness: 0 }));
  glass.position.set(-.05, .38, 0); stand.add(glass);
  for (let i = -8; i <= 8; i++) {
    const line = new THREE.Mesh(new THREE.BoxGeometry(.012, .38, .008), new THREE.MeshBasicMaterial({ color: 0xb5f0ff, transparent: true, opacity: .28 }));
    line.position.set(-.078, .38, i * .021); stand.add(line);
  }
}

function addScreen(x) {
  const stand = baseStand(x);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(.11, 1.02, 1.82), new THREE.MeshStandardMaterial({ color: 0x242e39, roughness: .38, metalness: .48 }));
  frame.position.y = .52; frame.castShadow = true; stand.add(frame);
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
  screenTexture = new THREE.CanvasTexture(canvas); screenTexture.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(1.68, .88), new THREE.MeshBasicMaterial({ map: screenTexture }));
  face.rotation.y = -Math.PI / 2; face.position.set(-.061, .52, 0); stand.add(face);
  screenMesh = stand;
}

function resizeScene() {
  if (fallbackCanvas) {
    const host = $('scene');
    fallbackCanvas.width = Math.max(1, host.clientWidth * Math.min(devicePixelRatio, 2));
    fallbackCanvas.height = Math.max(1, host.clientHeight * Math.min(devicePixelRatio, 2));
    drawFallbackScene();
    return;
  }
  const host = $('scene');
  camera.aspect = host.clientWidth / host.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(host.clientWidth, host.clientHeight);
}

function initFallbackScene() {
  const host = $('scene');
  host.replaceChildren();
  document.querySelector('.optical-labels').style.display = 'none';
  fallbackCanvas = document.createElement('canvas');
  fallbackCanvas.setAttribute('aria-label', 'Оптическая установка: источник, дифракционная решётка и экран');
  host.appendChild(fallbackCanvas);
  beam = { material: { opacity: 0 } };
  lightGlow = { material: { opacity: .06 } };
  screenMesh = { position: { x: 0 } };
  camera = { position: { set() {} } };
  controls = { target: { set() {} }, update() {} };
  window.addEventListener('resize', resizeScene);
  resizeScene();
}

function drawFallbackScene() {
  if (!fallbackCanvas) return;
  const ctx = fallbackCanvas.getContext('2d');
  const w = fallbackCanvas.width, h = fallbackCanvas.height;
  ctx.clearRect(0, 0, w, h);
  const sx = w / 1000, sy = h / 650;
  ctx.save(); ctx.scale(sx, sy);
  const bg = ctx.createRadialGradient(560, 230, 30, 540, 260, 620);
  bg.addColorStop(0, '#192635'); bg.addColorStop(.55, '#0d141d'); bg.addColorStop(1, '#06090e');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 1000, 650);

  ctx.fillStyle = '#151e28'; ctx.beginPath(); ctx.moveTo(90, 455); ctx.lineTo(780, 455); ctx.lineTo(932, 535); ctx.lineTo(145, 535); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#3b4857'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(120, 448); ctx.lineTo(890, 500); ctx.stroke();
  ctx.strokeStyle = '#8a97a6'; ctx.lineWidth = 5;
  [445, 471].forEach(y => { ctx.beginPath(); ctx.moveTo(145,y); ctx.lineTo(840,y+38); ctx.stroke(); });

  const sourceX = 195, gratingX = 470, screenX = 790 + (state.distanceCm - 50) * 2.2;
  drawStand2d(ctx, sourceX, 445, 145);
  drawStand2d(ctx, gratingX, 458, 150);
  drawStand2d(ctx, screenX, 478, 205);

  ctx.save(); ctx.translate(sourceX, 310);
  ctx.fillStyle = '#2f3a47'; ctx.strokeStyle = '#536170'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(-55,-34,92,68,16); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(31,-50); ctx.lineTo(93,-35); ctx.lineTo(93,35); ctx.lineTo(31,50); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = state.power ? '#fff0b9' : '#4b4e4f'; ctx.shadowColor = state.power ? '#ffcd67' : 'transparent'; ctx.shadowBlur = state.power ? 30 : 0;
  ctx.beginPath(); ctx.arc(39,0,17,0,Math.PI*2); ctx.fill(); ctx.restore();

  ctx.save(); ctx.translate(gratingX, 310);
  ctx.fillStyle = '#202a35'; ctx.fillRect(-14,-92,28,184); ctx.strokeStyle = '#8edfff'; ctx.lineWidth = 1;
  ctx.globalAlpha = .42; for (let y=-72;y<=72;y+=8){ctx.beginPath();ctx.moveTo(-10,y);ctx.lineTo(10,y);ctx.stroke();} ctx.globalAlpha=1; ctx.restore();

  ctx.save(); ctx.translate(screenX, 310);
  ctx.fillStyle = '#27323f'; ctx.fillRect(-12,-136,38,272); ctx.fillStyle = '#07090b'; ctx.fillRect(-14,-119,9,238);
  if (state.power) {
    drawGlowLine2d(ctx,-17,0,'#ffffff',7);
    Object.values(LINES).forEach(line => {
      const pos = maximumPositionMm(line.wavelength,state.linesPerMm,state.order,state.distanceCm);
      if (pos !== null && pos <= 160) { const yy = pos / 160 * 110; drawGlowLine2d(ctx,-17,yy,line.color,5); drawGlowLine2d(ctx,-17,-yy,line.color,5); }
    });
  }
  ctx.restore();

  if (state.power) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,226,165,.64)'; ctx.lineWidth = 3; ctx.shadowColor='#ffd276';ctx.shadowBlur=10;
    ctx.beginPath();ctx.moveTo(sourceX+92,310);ctx.lineTo(gratingX-14,310);ctx.stroke();
    Object.values(LINES).forEach(line=>{const pos=maximumPositionMm(line.wavelength,state.linesPerMm,state.order,state.distanceCm);if(pos!==null&&pos<=160){const yy=pos/160*110;ctx.strokeStyle=line.color;ctx.globalAlpha=.45;ctx.beginPath();ctx.moveTo(gratingX+14,310);ctx.lineTo(screenX-17,310+yy);ctx.stroke();ctx.beginPath();ctx.moveTo(gratingX+14,310);ctx.lineTo(screenX-17,310-yy);ctx.stroke();}});
    ctx.globalAlpha=1;ctx.globalCompositeOperation='source-over';ctx.shadowBlur=0;
  }

  ctx.fillStyle='#718096';ctx.font='600 12px system-ui';ctx.textAlign='center';
  ctx.fillText('ИСТОЧНИК',sourceX,580);ctx.fillText('РЕШЁТКА',gratingX,580);ctx.fillText('ЭКРАН',screenX,580);
  ctx.restore();
}

function drawStand2d(ctx, x, y, height) {
  ctx.fillStyle='#313c49';ctx.strokeStyle='#566273';ctx.lineWidth=2;
  ctx.beginPath();ctx.roundRect(x-42,y,84,15,5);ctx.fill();ctx.stroke();
  ctx.fillStyle='#465362';ctx.fillRect(x-5,y-height,10,height);ctx.fillStyle='#202934';ctx.fillRect(x-48,y+14,96,10);
}

function drawGlowLine2d(ctx,x,y,color,width){ctx.save();ctx.strokeStyle=color;ctx.shadowColor=color;ctx.shadowBlur=18;ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x,y-10);ctx.lineTo(x,y+10);ctx.stroke();ctx.restore();}

function drawScreenTexture() {
  const canvas = screenTexture.image;
  const ctx = canvas.getContext('2d');
  const grad = ctx.createRadialGradient(512, 256, 0, 512, 256, 620);
  grad.addColorStop(0, '#141617'); grad.addColorStop(1, '#030405');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (!state.power) { screenTexture.needsUpdate = true; return; }
  paintBand(ctx, 512, [255,255,240], 1, 10);
  Object.values(LINES).forEach(line => {
    const x = maximumPositionMm(line.wavelength, state.linesPerMm, state.order, state.distanceCm);
    if (x === null) return;
    const px = x / 320 * canvas.width;
    paintBand(ctx, 512 + px, line.rgb, .9, 8);
    paintBand(ctx, 512 - px, line.rgb, .9, 8);
  });
  screenTexture.needsUpdate = true;
}

function paintBand(ctx, x, rgb, alpha, width) {
  for (let i = -34; i <= 34; i++) {
    const a = alpha * Math.exp(-(i * i) / (2 * width * width)) * .33;
    ctx.fillStyle = `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
    ctx.fillRect(x + i, 22, 1.3, 468);
  }
}

function updateSpectrum2d() {
  const container = $('spectrum2d');
  container.replaceChildren();
  const center = document.createElement('span'); center.className = 'spectral-band center-band'; container.appendChild(center);
  if (!state.power) return;
  Object.entries(LINES).forEach(([key, line]) => {
    const x = maximumPositionMm(line.wavelength, state.linesPerMm, state.order, state.distanceCm);
    if (x === null || x > 160) return;
    [-1, 1].forEach(sign => {
      const band = document.createElement('span');
      band.className = 'spectral-band';
      band.dataset.line = key;
      band.style.left = `${50 + sign * x / 320 * 100}%`;
      band.style.background = line.color;
      band.style.boxShadow = `0 0 8px 2px ${line.color}, 0 0 30px 7px ${line.color}66`;
      container.appendChild(band);
    });
  });
}

function updateAll() {
  $('distanceOut').textContent = `${format(state.distanceCm)} см`;
  $('powerDot').classList.toggle('on', state.power);
  $('statusText').textContent = state.power ? 'Источник включён' : 'Источник выключен';
  beam.material.opacity = state.power ? .72 : 0;
  lightGlow.material.opacity = state.power ? 1 : .06;
  screenMesh.position.x = (state.distanceCm - 50) / 17;
  if (fallbackCanvas) drawFallbackScene(); else drawScreenTexture();
  updateSpectrum2d();
  updateCursor();
}

function updateCursor() {
  const pct = 50 + state.cursorMm / 320 * 100;
  $('cursorLine').style.left = `${pct}%`;
  $('cursorBubble').textContent = `${format(state.cursorMm)} мм`;
  $('recordValue').textContent = `x = ${format(Math.abs(state.cursorMm))} мм`;
}

function showToast(message) {
  const toast = $('toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600);
}

function openMeasure() {
  if (!state.power) { showToast('Сначала включите источник света'); return; }
  $('measurementOverlay').hidden = false;
  const target = LINES[state.target];
  const exact = maximumPositionMm(target.wavelength, state.linesPerMm, state.order, state.distanceCm) || 0;
  state.cursorMm = Math.round((exact - 6) * 10) / 10;
  $('cursor').value = state.cursorMm;
  updateCursor();
  camera.position.set(5.2, 1.48, .02); controls.target.set(2.45 + (state.distanceCm - 50) / 17, 1.2, 0); controls.update();
}

function recordMeasurement() {
  const x = Math.abs(state.cursorMm);
  if (x < 2) { showToast('Наведите визир на спектральную линию'); return; }
  const item = { id: crypto.randomUUID(), line: state.target, order: state.order, distanceCm: state.distanceCm, linesPerMm: state.linesPerMm, xMm: x, answer: '', verdict: '' };
  state.measurements.push(item); saveMeasurements(); renderJournal();
  showToast('Измерение записано в журнал');
}

function saveMeasurements() { localStorage.setItem('lab73-measurements', JSON.stringify(state.measurements)); }

function renderJournal() {
  const body = $('journalBody'); body.replaceChildren();
  if (!state.measurements.length) {
    const tr = document.createElement('tr'); tr.className = 'empty-row';
    const td = document.createElement('td'); td.colSpan = 6; td.textContent = 'Пока нет измерений. Перейдите в режим измерения и наведите визир на спектральную линию.';
    tr.appendChild(td); body.appendChild(tr);
  } else {
    state.measurements.forEach(item => {
      const tr = document.createElement('tr');
      const line = LINES[item.line];
      tr.innerHTML = `<td><span class="line-name"><i class="color-swatch" style="color:${line.color};background:${line.color}"></i>${line.name}</span></td><td>${item.order}</td><td>${format(item.distanceCm)}</td><td>${format(item.xMm)}</td><td><input class="lambda-input" inputmode="decimal" aria-label="Расчётная длина волны для ${line.name.toLowerCase()} линии" placeholder="например, 530" value="${item.answer}"></td><td><button class="check-btn" type="button">Проверить</button></td>`;
      const input = tr.querySelector('input');
      input.addEventListener('input', () => { item.answer = input.value.replace(',', '.'); item.verdict = ''; saveMeasurements(); });
      tr.querySelector('button').addEventListener('click', (event) => {
        const answer = Number(item.answer);
        if (!Number.isFinite(answer) || answer <= 0) { showToast('Введите рассчитанную длину волны в нм'); return; }
        const fromMeasurement = calculatedWavelengthNm(item.xMm, item.distanceCm, item.linesPerMm, item.order);
        const error = Math.abs(answer - fromMeasurement) / fromMeasurement * 100;
        item.verdict = error <= 3 ? 'good' : 'bad'; saveMeasurements();
        event.currentTarget.outerHTML = item.verdict === 'good' ? '<span class="result-good">Верно · ≤ 3%</span>' : `<span class="result-bad">Ошибка ${format(error)}%</span>`;
        updateProgress();
      });
      if (item.verdict) tr.lastElementChild.innerHTML = item.verdict === 'good' ? '<span class="result-good">Верно · ≤ 3%</span>' : '<span class="result-bad">Нужно проверить</span>';
      body.appendChild(tr);
    });
  }
  updateProgress();
}

function updateProgress() {
  const passed = new Set(state.measurements.filter(x => x.verdict === 'good').map(x => x.line)).size;
  $('progressText').textContent = `${passed} / 3 линий`;
}

function bindUI() {
  $('power').addEventListener('change', (e) => { state.power = e.target.checked; updateAll(); });
  $('distance').addEventListener('input', (e) => { state.distanceCm = Number(e.target.value); updateAll(); });
  $('grating').addEventListener('change', (e) => { state.linesPerMm = Number(e.target.value); updateAll(); });
  $('targetLine').addEventListener('change', (e) => { state.target = e.target.value; });
  document.querySelectorAll('.order').forEach(btn => btn.addEventListener('click', () => {
    state.order = Number(btn.dataset.order);
    document.querySelectorAll('.order').forEach(b => b.classList.toggle('active', b === btn));
    updateAll();
  }));
  $('cursor').addEventListener('input', (e) => { state.cursorMm = Number(e.target.value); updateCursor(); });
  $('measureView').addEventListener('click', openMeasure);
  $('closeMeasure').addEventListener('click', () => { $('measurementOverlay').hidden = true; });
  $('recordMeasurement').addEventListener('click', recordMeasurement);
  $('resetView').addEventListener('click', () => { $('measurementOverlay').hidden = true; camera.position.set(5.8, 3.5, 5.7); controls.target.set(0, .65, 0); controls.update(); });
  $('clearJournal').addEventListener('click', () => { state.measurements = []; saveMeasurements(); renderJournal(); showToast('Журнал очищен'); });
}

function registerWebMCP() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const tools = [
    {
      name: 'configure_diffraction_experiment', title: 'Настроить опыт',
      description: 'Включает источник и задаёт расстояние, решётку, порядок спектра и измеряемую линию.',
      inputSchema: { type: 'object', properties: { distanceCm: { type: 'number', minimum: 30, maximum: 80 }, linesPerMm: { type: 'integer', enum: [100, 200] }, order: { type: 'integer', enum: [1, 2] }, line: { type: 'string', enum: ['red', 'green', 'blue'] } }, required: ['distanceCm', 'linesPerMm', 'order', 'line'], additionalProperties: false },
      annotations: { readOnlyHint: false, untrustedContentHint: false },
      execute(input) {
        if (!input || input.distanceCm < 30 || input.distanceCm > 80 || ![100,200].includes(input.linesPerMm) || ![1,2].includes(input.order) || !LINES[input.line]) throw new Error('Некорректные параметры опыта');
        state.power = true; state.distanceCm = input.distanceCm; state.linesPerMm = input.linesPerMm; state.order = input.order; state.target = input.line;
        $('power').checked = true; $('distance').value = input.distanceCm; $('grating').value = input.linesPerMm; $('targetLine').value = input.line;
        document.querySelectorAll('.order').forEach(b => b.classList.toggle('active', Number(b.dataset.order) === input.order)); updateAll();
        return { configured: true, distanceCm: state.distanceCm, linesPerMm: state.linesPerMm, order: state.order, line: state.target };
      }
    },
    {
      name: 'read_experiment_state', title: 'Прочитать состояние опыта', description: 'Возвращает текущую настройку установки и число записей в журнале.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute() { return { power: state.power, distanceCm: state.distanceCm, linesPerMm: state.linesPerMm, order: state.order, targetLine: state.target, measurementCount: state.measurements.length }; }
    }
  ];
  tools.forEach(tool => { try { Promise.resolve(context.registerTool(tool)).catch(() => {}); } catch {} });
}

try { initScene(); } catch (error) { console.warn('WebGL недоступен, включён совместимый режим визуализации.', error); initFallbackScene(); }
bindUI();
renderJournal();
updateAll();
registerWebMCP();
