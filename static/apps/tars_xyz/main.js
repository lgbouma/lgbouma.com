import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const TAB20C = [
  [0.19215686274509805, 0.5098039215686274, 0.7411764705882353],
  [0.4196078431372549, 0.6823529411764706, 0.8392156862745098],
  [0.6196078431372549, 0.792156862745098, 0.8823529411764706],
  [0.7764705882352941, 0.8588235294117647, 0.9372549019607843],
  [0.9019607843137255, 0.3333333333333333, 0.050980392156862744],
  [0.9921568627450981, 0.5529411764705883, 0.23529411764705882],
  [0.9921568627450981, 0.6823529411764706, 0.4196078431372549],
  [0.9921568627450981, 0.8156862745098039, 0.6352941176470588],
  [0.19215686274509805, 0.6392156862745098, 0.32941176470588235],
  [0.4549019607843137, 0.7686274509803922, 0.4627450980392157],
  [0.6313725490196078, 0.8509803921568627, 0.6078431372549019],
  [0.7803921568627451, 0.9137254901960784, 0.7529411764705882],
  [0.4588235294117647, 0.4196078431372549, 0.6941176470588235],
  [0.6196078431372549, 0.6039215686274509, 0.7843137254901961],
  [0.7372549019607844, 0.7411764705882353, 0.8627450980392157],
  [0.8549019607843137, 0.8549019607843137, 0.9215686274509803],
  [0.38823529411764707, 0.38823529411764707, 0.38823529411764707],
  [0.5882352941176471, 0.5882352941176471, 0.5882352941176471],
  [0.7411764705882353, 0.7411764705882353, 0.7411764705882353],
  [0.8509803921568627, 0.8509803921568627, 0.8509803921568627],
];

const state = {
  meta: null,
  geometry: null,
  material: null,
  autoRotate: false,
  rotationSpeed: 0.4,
  autoStep: false,
  stepRate: 5.0,
  stepAccumulator: 0,
  isDark: false,
  cloudGroup: null,
};

const dom = {
  canvas: document.getElementById("gl"),
  status: document.getElementById("status"),
  colorMode: document.getElementById("colorMode"),
  vampWidth: document.getElementById("vampWidth"),
  vampStart: document.getElementById("vampStart"),
  vampWidthVal: document.getElementById("vampWidthVal"),
  vampStartVal: document.getElementById("vampStartVal"),
  pointSize: document.getElementById("pointSize"),
  pointSizeVal: document.getElementById("pointSizeVal"),
  toggleAxes: document.getElementById("toggleAxes"),
  toggleRotate: document.getElementById("toggleRotate"),
  rotateSpeed: document.getElementById("rotateSpeed"),
  rotateSpeedVal: document.getElementById("rotateSpeedVal"),
  toggleVampStep: document.getElementById("toggleVampStep"),
  vampStepRate: document.getElementById("vampStepRate"),
  vampStepRateVal: document.getElementById("vampStepRateVal"),
  howtoBtn: document.getElementById("howtoBtn"),
  howtoText: document.getElementById("howtoText"),
  toggleTheme: document.getElementById("toggleTheme"),
};

const scene = new THREE.Scene();
const appRoot = document.getElementById("app");
const clock = new THREE.Clock();
const VAMP_MIN = 0;
const VAMP_MAX = 100;
const VAMP_START_MAX = 50;
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 1, 6000);
camera.position.set(780, 620, 860);

const renderer = new THREE.WebGLRenderer({ canvas: dom.canvas, antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio || 1);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 200;
controls.maxDistance = 2400;

const cloudGroup = new THREE.Group();
scene.add(cloudGroup);
state.cloudGroup = cloudGroup;

const axesGroup = new THREE.Group();
const axesMaterial = new THREE.LineBasicMaterial({
  color: 0x8a8f98,
  transparent: true,
  opacity: 1.0,
});

function makeCircle(radius, segments = 256) {
  const points = [];
  for (let i = 0; i <= segments; i += 1) {
    const theta = (i / segments) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(theta) * radius, Math.sin(theta) * radius, 0));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.LineLoop(geometry, axesMaterial);
}

function makeArrowHead(tip, dir, size = 24, spread = 12) {
  const base = tip.clone().add(dir.clone().multiplyScalar(-size));
  const perp = new THREE.Vector3(-dir.y, dir.x, 0).normalize().multiplyScalar(spread);
  const left = base.clone().add(perp);
  const right = base.clone().add(perp.clone().multiplyScalar(-1));
  const geometry = new THREE.BufferGeometry().setFromPoints([left, tip, right]);
  return new THREE.Line(geometry, axesMaterial);
}

function buildAxes() {
  const xGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-500, 0, 0),
    new THREE.Vector3(500, 0, 0),
  ]);
  const yGeom = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, -500, 0),
    new THREE.Vector3(0, 500, 0),
  ]);

  axesGroup.add(new THREE.Line(xGeom, axesMaterial));
  axesGroup.add(new THREE.Line(yGeom, axesMaterial));
  axesGroup.add(makeArrowHead(new THREE.Vector3(500, 0, 0), new THREE.Vector3(1, 0, 0)));
  axesGroup.add(makeArrowHead(new THREE.Vector3(0, 500, 0), new THREE.Vector3(0, 1, 0)));
  [100, 200, 300, 400, 500].forEach((radius) => {
    axesGroup.add(makeCircle(radius));
  });
  axesGroup.visible = true;
  cloudGroup.add(axesGroup);
}

const tab20cColors = TAB20C.map((rgb) => new THREE.Color(rgb[0], rgb[1], rgb[2]));

const vertexShader = `
  attribute float v_amp;
  uniform float uPointSize;
  varying float vVamp;

  void main() {
    vVamp = v_amp;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = uPointSize;
  }
`;

const fragmentShader = `
  precision highp float;
  uniform bool uColorByVamp;
  uniform float uVMin;
  uniform float uVMax;
  uniform float uColorMin;
  uniform float uColorMax;
  uniform vec3 uTab20c[20];
  uniform vec3 uBaseColor;
  varying float vVamp;

  vec3 tab20c(float t) {
    float clamped = clamp(t, 0.0, 0.9999);
    int idx = int(floor(clamped * 20.0));
    return uTab20c[idx];
  }

  void main() {
    vec2 uv = gl_PointCoord - vec2(0.5);
    if (dot(uv, uv) > 0.25) discard;
    if (vVamp < uVMin || vVamp > uVMax) discard;

    vec3 color = uBaseColor;
    if (uColorByVamp) {
      float t = (vVamp - uColorMin) / (uColorMax - uColorMin);
      color = tab20c(t);
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;

function setStatus(message) {
  dom.status.textContent = message;
}

function applyTheme(isDark) {
  state.isDark = isDark;
  if (isDark) {
    appRoot.setAttribute("data-theme", "dark");
    dom.toggleTheme.textContent = "Black on white";
    if (state.material) {
      state.material.uniforms.uBaseColor.value.setHex(0xf4f6fb);
    }
  } else {
    appRoot.setAttribute("data-theme", "light");
    dom.toggleTheme.textContent = "White on black";
    if (state.material) {
      state.material.uniforms.uBaseColor.value.setHex(0x1a1f2a);
    }
  }
}

function updateStatusRange(start, end) {
  const startVal = start.toFixed(0);
  const endVal = end.toFixed(0);
  setStatus(`${startVal} < |v_T| < ${endVal}`);
}

function updateVampLabels(startVal, widthVal) {
  dom.vampStartVal.textContent = startVal.toFixed(0);
  dom.vampWidthVal.textContent = widthVal.toFixed(0);
}

function updateVampWindow() {
  if (!state.material) return;
  const width = parseFloat(dom.vampWidth.value);
  const start = parseFloat(dom.vampStart.value);
  const end = start + width;

  state.material.uniforms.uVMin.value = start;
  state.material.uniforms.uVMax.value = end;
  updateVampLabels(start, width);
  updateStatusRange(start, end);
}

function getMaxStart(width) {
  return Math.min(VAMP_START_MAX, VAMP_MAX - width);
}

function setupUI(meta) {
  dom.vampWidth.min = 1;
  dom.vampWidth.max = VAMP_MAX - VAMP_MIN;
  dom.vampWidth.step = 1;

  dom.vampStart.min = VAMP_MIN;
  dom.vampStart.step = 1;

  const width = parseFloat(dom.vampWidth.value);
  const maxStart = getMaxStart(width);
  dom.vampStart.max = maxStart;

  updateVampLabels(parseFloat(dom.vampStart.value), width);
  dom.vampStepRateVal.textContent = parseFloat(dom.vampStepRate.value).toFixed(1);

  dom.colorMode.addEventListener("change", () => {
    state.material.uniforms.uColorByVamp.value = dom.colorMode.value === "vamp";
  });

  dom.vampWidth.addEventListener("input", () => {
    const widthVal = parseFloat(dom.vampWidth.value);
    dom.vampWidthVal.textContent = widthVal.toFixed(0);
    const maxStart = getMaxStart(widthVal);
    dom.vampStart.max = maxStart;
    if (parseFloat(dom.vampStart.value) > maxStart) {
      dom.vampStart.value = maxStart;
    }
    updateVampWindow();
  });

  dom.vampStart.addEventListener("input", updateVampWindow);

  dom.pointSize.addEventListener("input", () => {
    const value = parseFloat(dom.pointSize.value);
    dom.pointSizeVal.textContent = value.toFixed(1);
    if (state.material) {
      state.material.uniforms.uPointSize.value = value;
    }
  });

  dom.toggleAxes.addEventListener("click", () => {
    axesGroup.visible = !axesGroup.visible;
    dom.toggleAxes.textContent = axesGroup.visible ? "Turn off axes" : "Turn on axes";
  });

  dom.toggleRotate.addEventListener("click", () => {
    state.autoRotate = !state.autoRotate;
    dom.toggleRotate.textContent = state.autoRotate ? "Stop rotation" : "Start rotation";
  });

  dom.rotateSpeed.addEventListener("input", () => {
    const value = Math.min(1, parseFloat(dom.rotateSpeed.value));
    dom.rotateSpeed.value = value.toFixed(2);
    state.rotationSpeed = value;
    dom.rotateSpeedVal.textContent = value.toFixed(2);
  });

  dom.toggleVampStep.addEventListener("click", () => {
    state.autoStep = !state.autoStep;
    state.stepAccumulator = 0;
    dom.toggleVampStep.textContent = state.autoStep
      ? "Stop velocity step"
      : "Start velocity step";
    dom.vampStart.disabled = state.autoStep;
  });

  dom.vampStepRate.addEventListener("input", () => {
    const value = parseFloat(dom.vampStepRate.value);
    state.stepRate = value;
    dom.vampStepRateVal.textContent = value.toFixed(1);
  });

  dom.howtoBtn.addEventListener("click", () => {
    const isHidden = dom.howtoText.hasAttribute("hidden");
    if (isHidden) {
      dom.howtoText.removeAttribute("hidden");
      dom.howtoBtn.textContent = "Hide tips";
    } else {
      dom.howtoText.setAttribute("hidden", "");
      dom.howtoBtn.textContent = "Show tips";
    }
  });

  dom.toggleTheme.addEventListener("click", () => {
    applyTheme(!state.isDark);
  });
}

function buildPoints(buffer, meta) {
  const floatData = new Float32Array(buffer);
  const stride = meta.point_stride_f32 ?? 4;
  const interleaved = new THREE.InterleavedBuffer(floatData, stride);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.InterleavedBufferAttribute(interleaved, 3, 0, false));
  geometry.setAttribute("v_amp", new THREE.InterleavedBufferAttribute(interleaved, 1, 3, false));
  geometry.computeBoundingSphere();

  const baseColor = state.isDark ? 0xf4f6fb : 0x1a1f2a;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uPointSize: { value: parseFloat(dom.pointSize?.value ?? 10) },
      uVMin: { value: meta.vmin },
      uVMax: { value: meta.vmax },
      uColorMin: { value: meta.vmin },
      uColorMax: { value: meta.vmax },
      uTab20c: { value: tab20cColors },
      uColorByVamp: { value: false },
      uBaseColor: { value: new THREE.Color(baseColor) },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
  });

  const points = new THREE.Points(geometry, material);
  cloudGroup.add(points);

  state.geometry = geometry;
  state.material = material;

  if (geometry.boundingSphere) {
    const radius = geometry.boundingSphere.radius;
    const center = geometry.boundingSphere.center;
    const distance = radius * 2.1;
    camera.position.set(center.x, center.y, center.z + distance);
    controls.target.copy(center);
    controls.update();
  }
}

async function init() {
  try {
    buildAxes();
    setStatus("Loading metadata…");
    const metaResp = await fetch("./api/meta.json");
    const meta = await metaResp.json();
    state.meta = meta;
    setupUI(meta);
    applyTheme(appRoot.getAttribute("data-theme") === "dark");

    setStatus("Streaming points…");
    const dataResp = await fetch("./api/points.bin");
    const buffer = await dataResp.arrayBuffer();

    buildPoints(buffer, meta);
    updateVampWindow();
  } catch (err) {
    console.error(err);
    setStatus("Failed to load data");
  }
}

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();
  if (state.autoRotate && state.cloudGroup) {
    state.cloudGroup.rotation.z += delta * state.rotationSpeed;
  }
  if (state.autoStep) {
    const widthVal = parseFloat(dom.vampWidth.value);
    const maxStart = getMaxStart(widthVal);
    const span = maxStart - VAMP_MIN + 1;
    if (span > 0) {
      state.stepAccumulator += delta * state.stepRate;
      if (state.stepAccumulator >= 1) {
        const steps = Math.floor(state.stepAccumulator);
        state.stepAccumulator -= steps;
        let nextStart = parseFloat(dom.vampStart.value) + steps;
        if (nextStart > maxStart) {
          nextStart = VAMP_MIN + ((nextStart - VAMP_MIN) % span);
        }
        dom.vampStart.value = nextStart;
        updateVampWindow();
      }
    }
  }
  controls.update();
  renderer.render(scene, camera);
}

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

init();
animate();
