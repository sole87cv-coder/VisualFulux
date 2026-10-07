/* assets/shaders.js — VISUAL_FUMAÇA_FOLHA_00
 * WebGL1 em dois passes (com fallback automático para single-pass).
 *   Passe 1: fumaça (INTOCADA) + FOLHA em malha triangulada com nervuras
 *     curvadas em arco, nervuras terciárias, petíolo, estrelas major/minor
 *     com twinkle independente. Venom pelo giroscópio. Crescimento timelapse.
 *     Bandas (bass→base, mid→meio, treble→topo). Ripple do onset. Pitch → cor.
 *   Passe 2: chromatic + vinheta + grão.
 * Expõe window.VISUAL_FUMAÇA_FOLHA_00.setAudio(...) e .setOptions(...).
 */
(function () {
  'use strict';

  const state = {
    audio: 0, bass: 0, mid: 0, treble: 0, onset: 0,
    pitch: 0.5, pitchStr: 0,
    tilt: [0, 0], zoom: 1.0,
    morph: 0.35,
    colorMode: 'auto',
    speed: 1.0,
    chromatic: true,
    colorAmountResolved: 0.5,
    growth: 0,
  };

  const canvas = document.getElementById('stage') || (function () {
    const c = document.createElement('canvas');
    c.id = 'stage';
    document.body.appendChild(c);
    return c;
  })();

  const params = new URLSearchParams(location.search);
  const forcedEco = params.has('eco') ? params.get('eco') === '1' : null;
  function detectEco() {
    if (forcedEco !== null) return forcedEco;
    const hc = navigator.hardwareConcurrency || 4;
    const mem = navigator.deviceMemory || 4;
    return (hc <= 4 || mem <= 2);
  }
  let ecoMode = detectEco();

  // Qualidade adaptativa: mantém os efeitos, reduz os pixels processados em celulares.
  const compactScreen = Math.min(window.innerWidth, window.innerHeight) < 760;
  const minRenderScale = ecoMode ? 0.18 : (compactScreen ? 0.22 : 0.40);
  const maxRenderScale = ecoMode ? 0.78 : (compactScreen ? 0.98 : 0.80);
  let renderScale = ecoMode ? 0.54 : (compactScreen ? 0.72 : 0.80);
  let perfWindowStart = 0;
  let perfDeltaSum = 0;
  let perfDeltaCount = 0;
  let renderAccumulator = 0;
  let lastRenderedAt = 0;

  function adaptRenderScale(timestamp, dt) {
    if (dt >= 0.004 && dt <= 0.10) {
      perfDeltaSum += dt;
      perfDeltaCount++;
    }
    if (!perfWindowStart) perfWindowStart = timestamp;
    if (timestamp - perfWindowStart < 1000) return;

    const avgFrameMs = perfDeltaCount ? (perfDeltaSum / perfDeltaCount) * 1000 : 0;
    const targetFrameMs = compactScreen
      ? (ecoMode && renderScale <= 0.27 ? (1000 / 24) : (1000 / 30))
      : (1000 / 60);
    if (avgFrameMs > targetFrameMs + 5) {
      renderScale = Math.max(minRenderScale, renderScale * 0.88);
    } else if (avgFrameMs > 0 && avgFrameMs < targetFrameMs + 1.5) {
      renderScale = Math.min(maxRenderScale, renderScale + 0.018);
    }
    perfWindowStart = timestamp;
    perfDeltaSum = 0;
    perfDeltaCount = 0;
  }

  let running = true;
  let observerInView = true;
  function updateRunning() { running = !document.hidden && observerInView; }
  document.addEventListener('visibilitychange', updateRunning);
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      observerInView = entries.length ? entries[0].isIntersecting : true;
      updateRunning();
    }, { threshold: 0.01 });
    io.observe(canvas);
  }

  const VERT_FULL = `
precision mediump float;
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}
`;

  function fragScene(oct) {
    return `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 v_uv;

uniform vec2  u_res;
uniform float u_time;
uniform vec2  u_tilt;
uniform float u_volume;
uniform float u_bass;
uniform float u_mid;
uniform float u_treble;
uniform float u_onset;
uniform float u_morph;
uniform float u_colorAmount;
uniform float u_speed;
uniform float u_growth;
uniform float u_rippleAge;
uniform float u_pitch;
uniform float u_pitchStr;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
// Perfil procedural da lâmina: crista central, nervuras elevadas e bordas curvadas.
float leafRelief(vec2 p) {
  float t = clamp((p.y + 0.9) / 1.8, 0.0, 1.0);
  float w = 0.60 * pow(max(sin(3.14159 * t), 0.0), 0.5)
          * smoothstep(0.0, 0.08, t)
          * (1.0 - 0.45 * pow(t, 1.6));
  float x = abs(p.x) / max(w, 0.025);
  float coord = p.y - pow(abs(p.x), 0.70) * (0.70 + 0.25 * t);
  float ribs = 0.035 * (0.5 + 0.5 * cos(coord * 50.265));
  float pulseAge = clamp(u_rippleAge, 0.0, 1.2);
  float pulseGate = 1.0 - smoothstep(1.0, 1.2, u_rippleAge);
  float pulseFront = exp(-pow(x - pulseAge * 1.7, 2.0) * 90.0)
                   * exp(-pulseAge * 2.4) * pulseGate;
  return 0.16 * exp(-abs(p.x) * 8.0)
       + ribs * smoothstep(0.04, 0.22, abs(p.x))
       + pulseFront * 0.024
       - 0.12 * pow(clamp(x, 0.0, 1.0), 2.0);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p, int oct) {
  float v = 0.0, a = 0.5;
  mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    v += a * vnoise(p);
    p = rot * p * 2.02;
    a *= 0.5;
  }
  return v;
}
vec3 paletteSmoke(float t) {
  return mix(vec3(0.06, 0.07, 0.11), vec3(0.90, 0.93, 1.00), t);
}

void main() {
  vec2 raw = v_uv - 0.5;
  float aspect = u_res.x / max(1.0, u_res.y);

  vec2 pSmoke = raw;
  pSmoke.x *= aspect;
  pSmoke *= 2.0;
  pSmoke -= u_tilt * 0.25;

  vec2 lp = raw * 2.0;
  lp.x *= aspect;

  float time = u_time * u_speed;

  // ==================== FUMAÇA (INTOCADA) ====================
  float warp = 0.55 + u_bass * 1.35;
  vec2 q = vec2(
    fbm(pSmoke * 1.3 + time * 0.15, ${oct}),
    fbm(pSmoke * 1.3 + vec2(5.2, 1.3) + time * 0.13, ${oct})
  );
  vec2 r = vec2(
    fbm(pSmoke * 1.5 + warp * q + time * 0.20, ${oct}),
    fbm(pSmoke * 1.5 + warp * q + vec2(8.3, 2.8) + time * 0.18, ${oct})
  );
  float smokeField = fbm(pSmoke * 1.8 + 2.0 * r, ${oct});
  smokeField = smoothstep(0.22, 0.78, smokeField);

  float hueSmoke = smokeField + u_mid * 0.6 + u_volume * 0.25;
  vec3 colSmoke = paletteSmoke(smokeField + u_mid * 0.15);

  float audioDrive = smoothstep(0.03, 0.4, u_volume);
  vec3 audioHue = vec3(
    0.5 + 0.5 * sin(hueSmoke * 6.28 + u_time * 0.4),
    0.5 + 0.5 * sin(hueSmoke * 6.28 + u_time * 0.4 + 2.09),
    0.5 + 0.5 * sin(hueSmoke * 6.28 + u_time * 0.4 + 4.18)
  );
  vec3 tintedSmoke = mix(colSmoke, audioHue, 0.55);
  colSmoke = mix(colSmoke, tintedSmoke, audioDrive * (0.55 + u_bass * 0.45));
  colSmoke += audioHue * audioDrive * u_bass * 1.3 * smokeField;

  // Fumaça mais presente nas bordas de telas estreitas, com fluxo para o centro.
  vec2 screenMetric = vec2(v_uv.x * aspect, v_uv.y);
  float screenEdgeDist = min(min(screenMetric.x, (1.0 - v_uv.x) * aspect),
                             min(screenMetric.y, 1.0 - v_uv.y));
  float portraitFactor = 1.0 - smoothstep(0.82, 1.18, aspect);
  float edgeReach = 1.0 - smoothstep(0.015, 0.48, screenEdgeDist);
  float edgeFlowNoise = vnoise(pSmoke * 7.0 + r * 1.35
                             + vec2(time * 0.12, -time * 0.09));
  float screenSmoke = edgeReach * smoothstep(0.28, 0.78, edgeFlowNoise)
                    * portraitFactor * (0.35 + 0.65 * smokeField);

  vec2 grid = pSmoke * 14.0;
  grid += (r - 0.5) * (2.5 + u_bass * 5.0);
  float gx = abs(fract(grid.x) - 0.5);
  float gy = abs(fract(grid.y) - 0.5);
  float lineMask = 1.0 - smoothstep(0.0, 0.025, min(gx, gy));
  float dotMask  = 1.0 - smoothstep(0.0, 0.07, length(fract(grid) - 0.5));
  float wire = lineMask * 0.35 + dotMask * 0.9;

  // ==================== VENOM (folha) ====================
  float heightAboveStem = smoothstep(-0.9, 0.9, lp.y);
  float liquidAmt = 0.55 + u_bass * 0.75;

  lp.x += u_tilt.x * 0.55 * heightAboveStem * liquidAmt;
  lp.y += u_tilt.y * 0.40 * heightAboveStem * liquidAmt;

  vec2 wob = vec2(
    vnoise(lp * 3.5 + u_time * 0.5),
    vnoise(lp * 3.5 + u_time * 0.5 + 17.3)
  ) - 0.5;
  lp += wob * 0.06 * liquidAmt * heightAboveStem;

  lp.y /= (1.0 + u_bass * 0.15);
  lp.x += sin(u_time * 1.1 + lp.y * 1.5) * u_mid * 0.05;

  // ==================== SILHUETA ====================
  float leafT = clamp((lp.y + 0.9) / 1.8, 0.0, 1.0);

  // max(sin, 0.0) protege contra NaN em pow()
  float sinShape = max(sin(3.14159 * leafT), 0.0);
  float halfW = 0.60 * pow(sinShape, 0.5)
              * smoothstep(0.0, 0.08, leafT)
              * (1.0 - 0.45 * pow(leafT, 1.6));

  float insideY = smoothstep(-0.02, 0.02, leafT) * (1.0 - smoothstep(0.98, 1.02, leafT));
  float insideX = 1.0 - smoothstep(halfW - 0.01, halfW + 0.01, abs(lp.x));
  float inside = insideX * insideY;

  // PETÍOLO (cabinho curto embaixo)
  float petioleT = clamp((-lp.y - 0.9) / 0.28, 0.0, 1.0);
  float petioleW = 0.026 * (1.0 - petioleT * 0.5);
  float petiole = (1.0 - smoothstep(petioleW - 0.006, petioleW + 0.006, abs(lp.x)))
                * step(0.0, -lp.y - 0.90)
                * (1.0 - smoothstep(0.85, 1.0, petioleT));
  petiole *= smoothstep(0.0, 0.10, u_growth);

  float edgeDist = abs(abs(lp.x) - halfW);
  float edgeGlow = exp(-edgeDist * 22.0) * insideY;

  // ==================== CRESCIMENTO ====================
  float growFront = clamp(u_growth / 1.15, 0.0, 1.0);
  float growMask = 1.0 - smoothstep(growFront - 0.15, growFront + 0.05, leafT);
  growMask = mix(0.0, growMask, step(0.02, u_growth));

  // ==================== NERVURA CENTRAL ====================
  float midribW = 0.010 + u_bass * 0.008;
  float midrib = exp(-abs(lp.x) / midribW) * insideY * growMask;
  midrib += exp(-abs(lp.x) * 22.0) * 0.10 * insideY * growMask;

  // ==================== NERVURAS LATERAIS CURVAS ====================
  float veinCoord = lp.y - pow(abs(lp.x), 0.70) * (0.70 + 0.25 * leafT);
  float veinPhase = veinCoord * 8.0;
  float veinD = abs(fract(veinPhase + 0.5) - 0.5);
  float lateralVein = 1.0 - smoothstep(0.0, 0.050, veinD);
  lateralVein *= smoothstep(0.03, 0.14, abs(lp.x));
  lateralVein *= inside * growMask;

  // NERVURAS TERCIÁRIAS
  float veinPhase2 = veinCoord * 16.0 + u_mid * 0.35;
  float veinD2 = abs(fract(veinPhase2 + 0.5) - 0.5);
  float tertiaryVein = 1.0 - smoothstep(0.0, 0.030, veinD2);
  tertiaryVein *= smoothstep(0.06, 0.22, abs(lp.x));
  tertiaryVein *= inside * growMask;

  // ==================== MALHA TRIANGULADA ====================
  vec2 meshP = lp * 8.5;
  float centerBoost = 1.0 + 0.30 * exp(-abs(lp.x) * 4.0);
  meshP *= centerBoost;
  vec2 jit = vec2(vnoise(meshP * 0.8), vnoise(meshP * 0.8 + 13.7));
  meshP += (jit - 0.5) * 0.4;

  vec2 cell = floor(meshP);
  vec2 gv = fract(meshP);

  float bd = min(min(gv.x, 1.0 - gv.x), min(gv.y, 1.0 - gv.y));
  float borderLine = 1.0 - smoothstep(0.0, 0.045, bd);

  float ch = hash21(cell);
  float diagD = (ch > 0.5) ? abs(gv.x - gv.y) : abs(gv.x + gv.y - 1.0);
  float diagLine = 1.0 - smoothstep(0.0, 0.04, diagD);

  float meshLine = max(borderLine, diagLine) * inside * growMask;

  // ==================== ESTRELAS ====================
  float stars = 0.0;
  float starsMajor = 0.0;
  for (int i = 0; i < 2; i++) {
    for (int j = 0; j < 2; j++) {
      vec2 cornerOff = vec2(float(i), float(j));
      vec2 dv = gv - cornerOff;
      float r2 = dot(dv, dv);
      float core = exp(-r2 * 700.0);
      float rays = exp(-min(abs(dv.x) * 10.0 + abs(dv.y) * 100.0,
                            abs(dv.y) * 10.0 + abs(dv.x) * 100.0));
      float star = core + rays * 0.55;
      float br = hash21(cell + cornerOff + 0.7);
      float isMajor = step(0.82, br);
      float starSize = mix(0.65, 1.7, isMajor);
      float tw = 0.55 + 0.45 * sin(u_time * 3.0 + br * 20.0 + u_pitch * 3.0);
      float s = star * mix(0.35, 1.25, br) * tw * starSize;
      stars = max(stars, s);
      starsMajor = max(starsMajor, s * isMajor);
    }
  }
  stars *= inside * growMask;
  starsMajor *= inside * growMask;

  // ==================== BANDAS ====================
  float bandBass = 1.0 - smoothstep(0.0, 0.55, leafT);
  float bandMid  = smoothstep(0.15, 0.5, leafT) * (1.0 - smoothstep(0.5, 0.9, leafT));
  float bandTop  = smoothstep(0.55, 1.0, leafT);
  float bandGlow = bandBass * u_bass * 1.4 + bandMid * u_mid * 1.2 + bandTop * u_treble * 1.5;

  // ==================== MODULAÇÃO DE ÁUDIO ====================
  midrib       *= 0.85 + u_bass * 1.4;
  lateralVein  *= 0.65 + u_mid * 0.95;
  tertiaryVein *= 0.50 + u_mid * 0.70 + u_treble * 0.4;
  float flowAge = clamp(u_rippleAge, 0.0, 1.2);
  float flowGate = 1.0 - smoothstep(0.95, 1.15, u_rippleAge);
  float lateralPos = abs(lp.x) / max(halfW, 0.025);
  float inwardFront = exp(-pow(lateralPos - (1.0 - flowAge * 1.45), 2.0) * 48.0)
                    * exp(-flowAge * 1.7) * flowGate;
  float flowNoise = 0.45 + 0.55 * vnoise(lp * vec2(19.0, 13.0) + vec2(u_time * 0.22, -u_time * 0.16));
  float flowVeins = clamp(max(lateralVein, tertiaryVein * 0.8), 0.0, 1.0);
  float veinMist = flowVeins * inwardFront * flowNoise * inside * growMask;
  float edgeCellJoin = exp(-edgeDist * 30.0) * flowVeins
                    * (0.55 + 0.45 * flowNoise) * inside * growMask;
  float edgeVeinBlend = clamp(exp(-edgeDist * 13.0) * 0.18 + veinMist * 0.48, 0.0, 0.62);
  float edgeSmokeBlend = clamp(screenSmoke * flowVeins * (0.35 + 0.45 * flowNoise) * 0.62, 0.0, 0.48);
  edgeVeinBlend = clamp(edgeVeinBlend + edgeSmokeBlend, 0.0, 0.78);
  float veinDissolve = inwardFront * flowNoise * flowGate * 0.24;
  lateralVein *= 1.0 - veinDissolve;
  tertiaryVein *= 1.0 - veinDissolve;
  meshLine     *= 0.75 + u_volume * 0.9 + u_bass * 0.35;
  stars        *= 0.65 + u_volume * 1.4 + u_onset * 1.1;
  starsMajor   *= 0.80 + u_onset * 1.8;

  float sparkN = step(0.90 - u_treble * 0.15, hash21(floor(meshP * 3.0) + 0.5));
  stars += sparkN * u_treble * 0.9 * inside * growMask;

  // ==================== RIPPLE ====================
  float rippleCenter = u_rippleAge * 0.9;
  float dR = leafT - rippleCenter;
  float ripple = exp(-dR * dR * 30.0) * exp(-u_rippleAge * 1.5);
  ripple *= inside * growMask;

  float onsetPulse = u_onset * (midrib * 0.9 + lateralVein * 0.7 + meshLine * 0.35);

  // ==================== CORES ====================
  vec3 pitchCol = vec3(
    0.5 + 0.5 * sin(u_pitch * 6.283),
    0.5 + 0.5 * sin(u_pitch * 6.283 + 2.094),
    0.5 + 0.5 * sin(u_pitch * 6.283 + 4.188)
  );

  vec3 colVein = vec3(0.85, 0.90, 1.00);
  vec3 colMesh = vec3(0.65, 0.78, 0.95);
  vec3 colStar = vec3(1.00, 0.98, 1.00);

  colVein = mix(colVein, vec3(0.90, 1.00, 0.85), u_mid * 0.55);
  colMesh = mix(colMesh, vec3(0.75, 0.92, 0.85), u_mid * 0.4);
  colVein = mix(colVein, pitchCol, u_pitchStr * 0.70);
  colStar = mix(colStar, pitchCol, u_pitchStr * 0.60);

  vec3 leafCol = vec3(0.0);
  // Difusão e normal aproximada dão volume à folha sem mudar o passe da fumaça.
  float eps = 0.008;
  float hL = leafRelief(lp - vec2(eps, 0.0));
  float hR = leafRelief(lp + vec2(eps, 0.0));
  float hD = leafRelief(lp - vec2(0.0, eps));
  float hU = leafRelief(lp + vec2(0.0, eps));
  vec3 normalVec = vec3(hL - hR, hD - hU, 2.0 * eps);
  vec3 leafNormal = normalVec / max(length(normalVec), 0.0001);
  vec3 lightDir = normalize(vec3(-0.45, 0.62, 0.85));
  float diffuse = 0.38 + 0.62 * max(dot(leafNormal, lightDir), 0.0);
  vec3 viewDir = vec3(0.0, 0.0, 1.0);
  float specular = pow(max(dot(reflect(-lightDir, leafNormal), viewDir), 0.0), 24.0);
  float rimLight = pow(1.0 - clamp(dot(leafNormal, viewDir), 0.0, 1.0), 2.0)
                 * exp(-edgeDist * 10.0);
  float pulseAge = clamp(u_rippleAge, 0.0, 1.2);
  float pulseGate = 1.0 - smoothstep(1.0, 1.2, u_rippleAge);
  float pulseFront = exp(-pow(abs(lp.x) / max(halfW, 0.025) - pulseAge * 1.7, 2.0) * 90.0)
                   * exp(-pulseAge * 2.4) * pulseGate;
  float pulseStrength = clamp(0.45 + u_bass * 0.35 + u_onset * 0.35, 0.0, 1.0);
  vec3 leafBase = mix(vec3(0.018, 0.075, 0.040), vec3(0.10, 0.34, 0.16),
                      clamp(0.35 + 0.35 * u_mid + 0.2 * leafT, 0.0, 1.0));
  leafCol += leafBase * diffuse * inside * growMask;
  leafCol += vec3(0.48, 0.82, 0.56) * specular * inside * growMask * 0.42;
  leafCol += vec3(0.28, 0.62, 0.42) * rimLight * inside * growMask * 0.30;
  leafCol += vec3(0.22, 0.82, 1.0) * pulseFront * pulseStrength * inside * growMask * 2.1;
  leafCol += vec3(0.72, 0.95, 1.0) * pulseFront * pulseStrength * inside * growMask * 0.55;
  leafCol += colVein * midrib * 1.6;
  vec3 edgeVeinColor = mix(colVein, vec3(0.32, 0.72, 0.82), edgeVeinBlend);
  leafCol += edgeVeinColor * lateralVein * 1.0;
  leafCol += edgeVeinColor * tertiaryVein * 0.65;
  leafCol += mix(colVein, vec3(0.32, 0.72, 0.82), 0.68) * veinMist * 0.72;
  leafCol += vec3(0.38, 0.78, 0.88) * edgeCellJoin * (0.28 + 0.30 * inwardFront);
  leafCol += colMesh * meshLine * 0.55;
  leafCol += colStar * stars * 1.8;
  leafCol += colStar * starsMajor * 1.4;
  leafCol += vec3(0.55, 0.85, 1.00) * edgeGlow * 0.9;
  leafCol += vec3(1.0, 0.9, 1.0) * onsetPulse * 1.4;
  leafCol += vec3(1.0, 0.9, 1.0) * ripple * 2.5;
  leafCol += colVein * petiole * 1.2;
  leafCol += vec3(0.6, 0.8, 1.0) * bandGlow * inside * 0.08;

  // ==================== COMPOSIÇÃO ====================
  float morph = clamp(u_morph, 0.0, 1.0);

  vec3 col = colSmoke;
  col = mix(col, col * 0.25, inside * growMask * morph * 0.75);
  col += vec3(0.26, 0.34, 0.42) * screenSmoke * (0.22 + u_volume * 0.08);
  col += colSmoke * screenSmoke * inside * growMask * morph * 0.18;
  col += leafCol * morph;
  col += colSmoke * inside * growMask * morph * 0.35;

  float sparkle = step(0.985 - u_treble * 0.15, vnoise(pSmoke * 40.0 + time * 3.0));
  col += sparkle * u_treble * 1.4 * (1.0 - inside * growMask * morph);

  col += wire * (0.55 + u_volume * 1.3) * vec3(0.9, 0.95, 1.0)
       * (1.0 - inside * growMask * morph * 0.85);

  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(luma), col, clamp(u_colorAmount, 0.0, 1.0));

  float exposure = 1.05 + u_volume * 1.5 + u_onset * 0.7;
  col *= exposure;
  col = vec3(0.015) + col * (0.60 + u_volume * 1.10);

  gl_FragColor = vec4(col, 1.0);
}
`;
  }

  const FRAG_POST = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec2 v_uv;
uniform sampler2D u_scene;
uniform vec2  u_res;
uniform float u_time;
uniform float u_volume;
uniform float u_treble;
uniform float u_onset;

void main() {
  vec2 uv = v_uv;
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);

  float amt = (0.0015 + u_volume * 0.014 + u_onset * 0.012) * (0.4 + r2 * 2.5);
  vec2 off = normalize(c + 1e-5) * amt;

  float cr = texture2D(u_scene, uv + off).r;
  float cg = texture2D(u_scene, uv).g;
  float cb = texture2D(u_scene, uv - off).b;
  vec3 col = vec3(cr, cg, cb);

  col *= 1.0 - r2 * 0.32;

  float n = fract(sin(dot(uv * vec2(12.9898, 78.233), vec2(1.0)) + u_time) * 43758.5453);
  col += (n - 0.5) * (0.025 + u_treble * 0.05);

  gl_FragColor = vec4(col, 1.0);
}
`;

  let rendererMode = 'unknown';
  let gl = null;
  let glFailedHard = false;
  let postDisabled = false;
  let progScene = null;
  let progPost = null;
  const uS = {}, uP = {};
  let quad = null;
  let fbo = null;
  let lastTime = 0;
  let frameId = 0;
  let timeSec = 0;
  let lastOnsetTime = -10;
  let fallbackLastAt = 0;

  function compile(type, src, tag) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.error('[VISUAL_FUMAÇA_FOLHA_00] compile ' + tag + ':\n' + gl.getShaderInfoLog(s));
      gl.deleteShader(s);
      return null;
    }
    return s;
  }
  function link(vs, fs, tag) {
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      console.error('[VISUAL_FUMAÇA_FOLHA_00] link ' + tag + ':\n' + gl.getProgramInfoLog(p));
      return null;
    }
    return p;
  }

  function createFBO(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) {
      console.warn('[VISUAL_FUMAÇA_FOLHA_00] FBO incompleto — desativando post');
      gl.deleteFramebuffer(fb); gl.deleteTexture(tex);
      return null;
    }
    return { tex, fb, w, h };
  }
  function destroyFBO() {
    if (!fbo) return;
    gl.deleteFramebuffer(fbo.fb);
    gl.deleteTexture(fbo.tex);
    fbo = null;
  }

  function initGL() {
    const opts = { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' };
    try {
      gl = canvas.getContext('webgl', opts) || canvas.getContext('experimental-webgl', opts);
    } catch (e) { console.error('[VISUAL_FUMAÇA_FOLHA_00] getContext:', e); gl = null; }
    if (!gl) { console.error('[VISUAL_FUMAÇA_FOLHA_00] sem WebGL'); return false; }

    const vs = compile(gl.VERTEX_SHADER, VERT_FULL, 'vs');
    const shaderOctaves = compactScreen ? (ecoMode ? 3 : 4) : (ecoMode ? 4 : 6);
    const fsScene = compile(gl.FRAGMENT_SHADER, fragScene(shaderOctaves), 'fsScene');
    const fsPost = compile(gl.FRAGMENT_SHADER, FRAG_POST, 'fsPost');
    if (!vs || !fsScene || !fsPost) return false;

    progScene = link(vs, fsScene, 'scene');
    progPost = link(vs, fsPost, 'post');
    if (!progScene || !progPost) return false;

    ['u_res','u_time','u_tilt','u_volume','u_bass','u_mid','u_treble',
     'u_onset','u_morph','u_colorAmount','u_speed','u_growth','u_rippleAge',
     'u_pitch','u_pitchStr'].forEach((n) => {
      uS[n] = gl.getUniformLocation(progScene, n);
    });
    ['u_scene','u_res','u_time','u_volume','u_treble','u_onset'].forEach((n) => {
      uP[n] = gl.getUniformLocation(progPost, n);
    });

    quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);

    resizeGL();
    return true;
  }

  function ensureFBO(w, h) {
    if (fbo && fbo.w === w && fbo.h === h) return true;
    destroyFBO();
    fbo = createFBO(w, h);
    if (!fbo) { postDisabled = true; return false; }
    return true;
  }

  function resizeGL() {
    if (!gl) return false;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const device = w < 640 ? 'mobile' : w < 1024 ? 'tablet' : 'desktop';
    const maxDpr = { mobile: 1.0, tablet: 1.25, desktop: 1.5 }[device];
    const dpr = Math.min(window.devicePixelRatio || 1, maxDpr) * renderScale;
    const cw = Math.max(2, Math.round(w * dpr));
    const ch = Math.max(2, Math.round(h * dpr));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
    // Se o post já caiu, não tenta criar FBO — segue single-pass.
    if (postDisabled) return true;
    ensureFBO(cw, ch);
    return true;
  }

  function bindQuad(prog) {
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    if (loc < 0) return;                 // trava contra -1
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  }

  function boundedNumber(value, min, max, fallback) {
    return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
  }

  function resolveColorAmount() {
    if (state.colorMode === 'bw') return 0;
    if (state.colorMode === 'color') return 1;
    const t = Math.max(0, Math.min(1, (state.audio - 0.02) / (0.35 - 0.02)));
    return t * t * (3 - 2 * t);
  }

  function renderScene(targetFBO, w, h) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFBO);
    gl.viewport(0, 0, w, h);
    gl.useProgram(progScene);
    bindQuad(progScene);

    gl.uniform2f(uS.u_res, w, h);
    gl.uniform1f(uS.u_time, timeSec);
    gl.uniform2f(uS.u_tilt, state.tilt[0], state.tilt[1]);
    gl.uniform1f(uS.u_volume, state.audio);
    gl.uniform1f(uS.u_bass, state.bass);
    gl.uniform1f(uS.u_mid, state.mid);
    gl.uniform1f(uS.u_treble, state.treble);
    gl.uniform1f(uS.u_onset, state.onset);
    gl.uniform1f(uS.u_morph, state.morph);
    gl.uniform1f(uS.u_colorAmount, state.colorAmountResolved);
    gl.uniform1f(uS.u_speed, state.speed);
    gl.uniform1f(uS.u_growth, state.growth);
    gl.uniform1f(uS.u_rippleAge, timeSec - lastOnsetTime);
    gl.uniform1f(uS.u_pitch, state.pitch);
    gl.uniform1f(uS.u_pitchStr, state.pitchStr);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function renderPost() {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(progPost);
    bindQuad(progPost);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, fbo.tex);
    gl.uniform1i(uP.u_scene, 0);
    gl.uniform2f(uP.u_res, canvas.width, canvas.height);
    gl.uniform1f(uP.u_time, timeSec);
    gl.uniform1f(uP.u_volume, state.chromatic ? state.audio : 0);
    gl.uniform1f(uP.u_treble, state.treble);
    gl.uniform1f(uP.u_onset, state.chromatic ? state.onset : 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  function updateGrowth(dt) {
    let rate = 0.03 + state.audio * 0.45 + state.bass * 0.25;
    if (timeSec - lastOnsetTime < 0.08) rate += 0.9;
    state.growth = Math.min(1.2, state.growth + dt * rate);
    if (state.morph < 0.15) state.growth = Math.max(0, state.growth - dt * 0.5);
  }

  // Fallback quando WebGL falha de vez: gradiente visível, não tela preta.
  let ctx2d = null;
  function drawFallback2D() {
    if (!ctx2d) ctx2d = canvas.getContext('2d');
    if (!ctx2d) return;
    const w = window.innerWidth, h = window.innerHeight;
    const scale = compactScreen ? 0.5 : 0.75;
    const cw = Math.max(2, Math.round(w * scale));
    const ch = Math.max(2, Math.round(h * scale));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw; canvas.height = ch;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
    }
    const grd = ctx2d.createRadialGradient(cw/2, ch/2, 5, cw/2, ch/2, Math.min(cw,ch)*0.7);
    grd.addColorStop(0, 'rgba(120,180,255,0.55)');
    grd.addColorStop(1, 'rgba(4,6,10,1)');
    ctx2d.fillStyle = grd;
    ctx2d.fillRect(0, 0, cw, ch);
  }

  function frame(t) {
    frameId = requestAnimationFrame(frame);
    if (!running) { lastTime = t; return; }

    if (!gl && !glFailedHard) {
      if (!initGL()) {
        glFailedHard = true;
        rendererMode = 'canvas2d';
      } else {
        rendererMode = 'webgl';
      }
    }

    const dt = Math.min(0.1, Math.max(0.001, (t - lastTime) / 1000)) || 0.016;
    lastTime = t;
    timeSec += dt;

    if (rendererMode !== 'webgl') {
      if (compactScreen && t - fallbackLastAt < 1000 / 30) return;
      fallbackLastAt = t;
      drawFallback2D();
      return;
    }

    if (state.onset > 0.55 && timeSec - lastOnsetTime > 0.18) {
      lastOnsetTime = timeSec;
    }

    updateGrowth(dt);

    // Limita o custo do desenho em celulares, mantendo o áudio atualizado.
    if (compactScreen) {
      const frameInterval = ecoMode && renderScale <= 0.27 ? (1.0 / 24.0) : (1.0 / 30.0);
      renderAccumulator += dt;
      if (renderAccumulator < frameInterval) return;
      renderAccumulator %= frameInterval;
    }
    const renderedDelta = lastRenderedAt ? (t - lastRenderedAt) / 1000 : dt;
    lastRenderedAt = t;
    adaptRenderScale(t, renderedDelta);

    resizeGL();
    state.colorAmountResolved = resolveColorAmount();

    try {
      if (!postDisabled && fbo) {
        renderScene(fbo.fb, fbo.w, fbo.h);
        renderPost();
      } else {
        renderScene(null, canvas.width, canvas.height);
      }
    } catch (e) {
      console.error('[VISUAL_FUMAÇA_FOLHA_00] erro no render:', e);
      postDisabled = true;
    }
  }

  window.VISUAL_FUMAÇA_FOLHA_00 = window.VISUAL_FUMAÇA_FOLHA_00 || {};
  window.VISUAL_FUMAÇA_FOLHA_00.setAudio = function (obj) {
    if (!obj) return;
    if (typeof obj.audio === 'number')    state.audio  = boundedNumber(obj.audio, 0, 1.6, state.audio);
    if (typeof obj.bass === 'number')     state.bass   = boundedNumber(obj.bass, 0, 1.6, state.bass);
    if (typeof obj.mid === 'number')      state.mid    = boundedNumber(obj.mid, 0, 1.6, state.mid);
    if (typeof obj.treble === 'number')   state.treble = boundedNumber(obj.treble, 0, 1.6, state.treble);
    if (typeof obj.onset === 'number')    state.onset  = boundedNumber(obj.onset, 0, 1.5, state.onset);
    if (typeof obj.pitch === 'number')    state.pitch  = boundedNumber(obj.pitch, 0, 1, state.pitch);
    if (typeof obj.pitchStr === 'number') state.pitchStr = boundedNumber(obj.pitchStr, 0, 1, state.pitchStr);
    if (obj.tilt && Array.isArray(obj.tilt)) {
      state.tilt[0] = boundedNumber(obj.tilt[0], -3, 3, 0);
      state.tilt[1] = boundedNumber(obj.tilt[1], -3, 3, 0);
    }
    if (typeof obj.zoom === 'number') state.zoom = boundedNumber(obj.zoom, 0.25, 4, state.zoom);
  };
  window.VISUAL_FUMAÇA_FOLHA_00.setOptions = function (opts) {
    if (!opts) return;
    if (typeof opts.morph === 'number')      state.morph = boundedNumber(opts.morph, 0, 1, state.morph);
    if (typeof opts.speed === 'number')      state.speed = boundedNumber(opts.speed, 0.05, 3, state.speed);
    if (typeof opts.chromatic === 'boolean') state.chromatic = opts.chromatic;
    if (typeof opts.colorMode === 'string') {
      if (opts.colorMode === 'auto' || opts.colorMode === 'bw' || opts.colorMode === 'color') {
        state.colorMode = opts.colorMode;
      }
    }
    if (opts.resetGrowth) state.growth = 0;
  };
  window.VISUAL_FUMAÇA_FOLHA_00.renderer = () => rendererMode;
  window.VISUAL_FUMAÇA_FOLHA_00._internal = { state, ecoMode: () => ecoMode };

  lastTime = performance.now();
  frameId = requestAnimationFrame(frame);
})();














