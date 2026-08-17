const canvas = document.querySelector("#artwork")
const gl = canvas.getContext("webgl", {
  alpha: false,
  antialias: true,
  preserveDrawingBuffer: true,
})

if (!gl) {
  throw new Error("WebGL is required to render Penline.")
}

const vertexSource = `
  attribute vec2 a_position;
  varying vec2 v_uv;

  void main() {
    v_uv = a_position * 0.5 + 0.5;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`

const fragmentSource = `
  precision highp float;

  varying vec2 v_uv;
  uniform sampler2D u_image;
  uniform vec2 u_imageSize;
  uniform vec2 u_canvasSize;
  uniform float u_lines;
  uniform float u_weight;
  uniform float u_breakup;
  uniform float u_roughness;

  float hash(float n) {
    return fract(sin(n) * 43758.5453123);
  }

  float hash2(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float noise(float x, float seed) {
    float i = floor(x);
    float f = fract(x);
    float u = f * f * (3.0 - 2.0 * f);
    return mix(hash(i + seed), hash(i + 1.0 + seed), u);
  }

  float fbm(float x, float seed) {
    return noise(x, seed) * 0.58
      + noise(x * 2.07, seed + 31.7) * 0.28
      + noise(x * 4.13, seed + 83.1) * 0.14;
  }

  float noise2(vec2 point) {
    vec2 cell = floor(point);
    vec2 local = fract(point);
    vec2 blend = local * local * (3.0 - 2.0 * local);
    float top = mix(hash2(cell), hash2(cell + vec2(1.0, 0.0)), blend.x);
    float bottom = mix(hash2(cell + vec2(0.0, 1.0)), hash2(cell + 1.0), blend.x);
    return mix(top, bottom, blend.y);
  }

  vec2 coverUv(vec2 uv) {
    float canvasRatio = u_canvasSize.x / u_canvasSize.y;
    float imageRatio = u_imageSize.x / u_imageSize.y;
    vec2 scale = vec2(1.0);

    if (imageRatio > canvasRatio) {
      scale.x = canvasRatio / imageRatio;
    } else {
      scale.y = imageRatio / canvasRatio;
    }

    return (uv - 0.5) * scale + 0.5;
  }

  float darknessAt(vec2 uv) {
    vec4 sample = texture2D(u_image, coverUv(uv));
    vec3 color = mix(vec3(1.0), sample.rgb, sample.a);
    float luminance = dot(color, vec3(0.299, 0.587, 0.114));
    return 1.0 - luminance;
  }

  void main() {
    vec2 canvasUv = vec2(v_uv.x, 1.0 - v_uv.y);
    float padding = 0.08;
    vec2 uv = (canvasUv - padding) / (1.0 - padding * 2.0);
    float inside = step(0.0, uv.x) * step(uv.x, 1.0)
      * step(0.0, uv.y) * step(uv.y, 1.0);
    float row = floor(uv.y * u_lines);
    float rowCenter = (row + 0.5) / u_lines;
    float seed = row * 71.319;

    float edgeJitter = (hash(seed + 9.0) - 0.5) * u_roughness * 0.008;
    vec2 sampleUv = vec2(uv.x + edgeJitter, rowCenter);
    float pixelStep = 1.0 / u_imageSize.x;
    float darkness = darknessAt(sampleUv) * 0.5;
    darkness += darknessAt(sampleUv + vec2(pixelStep * 2.0, 0.0)) * 0.25;
    darkness += darknessAt(sampleUv - vec2(pixelStep * 2.0, 0.0)) * 0.25;
    darkness = smoothstep(0.172, 0.808, darkness);

    float withinRow = fract(uv.y * u_lines) - 0.5;
    float x = uv.x * mix(28.0, 65.0, u_breakup);
    float breakNoise = fbm(x, seed);
    float lightness = 1.0 - darkness;
    float breakupInfluence = u_breakup * smoothstep(0.05, 0.65, lightness);
    float highlightThreshold = mix(0.88, 0.32, darkness);
    float threshold = mix(-0.05, highlightThreshold, sqrt(breakupInfluence));
    float endFray = noise2(vec2(uv.x * 240.0, withinRow * 8.0 + seed));
    float frayedThreshold = threshold
      + (endFray - 0.5) * u_roughness * breakupInfluence * 0.16;
    float occupancy = smoothstep(frayedThreshold - 0.035, frayedThreshold + 0.035, breakNoise);
    occupancy = max(occupancy, smoothstep(0.7, 0.9, darkness));
    occupancy *= smoothstep(0.025, 0.13, darkness);

    float wobble = (noise(uv.x * 17.0, seed + 13.0) - 0.5) * u_roughness * 0.14;
    wobble += (noise(uv.x * 61.0, seed + 27.0) - 0.5) * u_roughness * 0.06;
    float thicknessNoise = noise(uv.x * 74.0, seed + 47.0) - 0.5;
    float thickness = mix(0.06, 0.31, u_weight) * mix(0.55, 1.15, darkness);
    thickness += thicknessNoise * u_roughness * 0.15;

    float topFray = (fbm(uv.x * 190.0, seed + 101.0) - 0.5) * u_roughness * 0.28;
    float bottomFray = (fbm(uv.x * 215.0, seed + 151.0) - 0.5) * u_roughness * 0.28;
    topFray += (noise(uv.x * 520.0, seed + 191.0) - 0.5) * u_roughness * 0.07;
    bottomFray += (noise(uv.x * 470.0, seed + 223.0) - 0.5) * u_roughness * 0.07;

    float topEdge = max(0.012, thickness + topFray);
    float bottomEdge = max(0.012, thickness + bottomFray);
    float strokeY = withinRow + wobble;
    float lowerMask = smoothstep(-bottomEdge - 0.045, -bottomEdge + 0.045, strokeY);
    float upperMask = 1.0 - smoothstep(topEdge - 0.045, topEdge + 0.045, strokeY);
    float line = lowerMask * upperMask;

    float edgeDistance = min(topEdge - strokeY, strokeY + bottomEdge);
    float edgeProximity = 1.0 - smoothstep(0.0, max(thickness * 0.7, 0.02), edgeDistance);
    float endProximity = 1.0 - smoothstep(0.0, 0.7, abs(occupancy * 2.0 - 1.0));
    float coarseGrain = noise2(gl_FragCoord.xy * vec2(0.38, 0.52) + seed);
    float fineGrain = hash2(floor(gl_FragCoord.xy) + seed);
    float grain = mix(coarseGrain, fineGrain, 0.35);
    float erosionThreshold = mix(0.025, 0.52, max(edgeProximity, endProximity)) * u_roughness;
    float deposited = smoothstep(erosionThreshold - 0.045, erosionThreshold + 0.045, grain);
    float inkTexture = mix(0.76, 1.0, fineGrain);
    float ink = line * occupancy * deposited * inkTexture * inside;

    vec3 paper = vec3(0.969, 0.961, 0.925);
    vec3 pigment = vec3(0.055, 0.052, 0.045);
    gl_FragColor = vec4(mix(paper, pigment, ink), 1.0);
  }
`

function createShader(type, source) {
  const shader = gl.createShader(type)
  gl.shaderSource(shader, source)
  gl.compileShader(shader)

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader))
  }

  return shader
}

function createProgram() {
  const program = gl.createProgram()
  gl.attachShader(program, createShader(gl.VERTEX_SHADER, vertexSource))
  gl.attachShader(program, createShader(gl.FRAGMENT_SHADER, fragmentSource))
  gl.linkProgram(program)

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program))
  }

  return program
}

function createDefaultPortrait() {
  const source = document.createElement("canvas")
  source.width = 1000
  source.height = 1250
  const context = source.getContext("2d")
  const gradient = context.createLinearGradient(0, 170, 0, 1120)
  gradient.addColorStop(0, "#171717")
  gradient.addColorStop(0.48, "#565656")
  gradient.addColorStop(1, "#0d0d0d")

  context.fillStyle = "#f7f7f4"
  context.fillRect(0, 0, source.width, source.height)
  context.fillStyle = gradient
  context.beginPath()
  context.moveTo(425, 190)
  context.bezierCurveTo(540, 105, 705, 170, 740, 320)
  context.bezierCurveTo(765, 430, 715, 555, 640, 635)
  context.bezierCurveTo(620, 720, 655, 775, 730, 820)
  context.bezierCurveTo(850, 875, 920, 970, 950, 1160)
  context.lineTo(80, 1160)
  context.bezierCurveTo(110, 970, 205, 870, 355, 810)
  context.bezierCurveTo(410, 765, 420, 710, 400, 640)
  context.bezierCurveTo(320, 580, 270, 470, 285, 345)
  context.bezierCurveTo(300, 270, 350, 220, 425, 190)
  context.fill()

  context.globalCompositeOperation = "screen"
  const highlight = context.createRadialGradient(430, 390, 15, 470, 420, 270)
  highlight.addColorStop(0, "rgba(255,255,255,.9)")
  highlight.addColorStop(0.45, "rgba(255,255,255,.28)")
  highlight.addColorStop(1, "rgba(255,255,255,0)")
  context.fillStyle = highlight
  context.fillRect(180, 130, 650, 650)
  context.globalCompositeOperation = "source-over"

  return source
}

const program = createProgram()
const position = gl.getAttribLocation(program, "a_position")
const positionBuffer = gl.createBuffer()
gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
gl.bufferData(
  gl.ARRAY_BUFFER,
  new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
  gl.STATIC_DRAW,
)

const uniforms = Object.fromEntries(
  ["image", "imageSize", "canvasSize", "lines", "weight", "breakup", "roughness"].map((name) => [
    name,
    gl.getUniformLocation(program, `u_${name}`),
  ]),
)

const texture = gl.createTexture()
gl.bindTexture(gl.TEXTURE_2D, texture)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)

let imageSize = [1000, 1250]

function setTexture(source) {
  imageSize = [source.width, source.height]
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
  render()
}

const defaults = { lines: 80, weight: 52, breakup: 58, roughness: 46 }
const resetButton = document.querySelector("#reset-button")
const controls = {
  lines: document.querySelector("#lines"),
  weight: document.querySelector("#weight"),
  breakup: document.querySelector("#breakup"),
  roughness: document.querySelector("#roughness"),
}

function updateResetButton() {
  const isDefault = Object.entries(defaults).every(
    ([name, value]) => Number(controls[name].value) === value,
  )
  resetButton.classList.toggle("is-hidden", isDefault)
  resetButton.disabled = isDefault
  resetButton.setAttribute("aria-hidden", String(isDefault))
}

function render() {
  gl.viewport(0, 0, canvas.width, canvas.height)
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  gl.uniform1i(uniforms.image, 0)
  gl.uniform2f(uniforms.imageSize, imageSize[0], imageSize[1])
  gl.uniform2f(uniforms.canvasSize, canvas.width, canvas.height)
  gl.uniform1f(uniforms.lines, Number(controls.lines.value))
  gl.uniform1f(uniforms.weight, Number(controls.weight.value) / 100)
  gl.uniform1f(uniforms.breakup, Number(controls.breakup.value) / 100)
  gl.uniform1f(uniforms.roughness, Number(controls.roughness.value) / 100)
  gl.drawArrays(gl.TRIANGLES, 0, 6)
}

for (const [name, input] of Object.entries(controls)) {
  input.addEventListener("input", () => {
    document.querySelector(`#${name}-value`).value = input.value
    updateResetButton()
    render()
  })
}

function loadFile(file) {
  if (!file?.type.startsWith("image/")) return

  const image = new Image()
  const url = URL.createObjectURL(file)
  image.addEventListener("load", () => {
    setTexture(image)
    URL.revokeObjectURL(url)
  })
  image.src = url
}

document.querySelector("#image-input").addEventListener("change", (event) => {
  loadFile(event.target.files[0])
})

const dropZone = document.querySelector("#drop-zone")
for (const eventName of ["dragenter", "dragover"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault()
    dropZone.classList.add("dragging")
  })
}

for (const eventName of ["dragleave", "drop"]) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault()
    dropZone.classList.remove("dragging")
  })
}

dropZone.addEventListener("drop", (event) => loadFile(event.dataTransfer.files[0]))

document.querySelector("#save-button").addEventListener("click", () => {
  render()
  const link = document.createElement("a")
  link.download = "penline.png"
  link.href = canvas.toDataURL("image/png")
  link.click()
})

resetButton.addEventListener("click", () => {
  for (const [name, value] of Object.entries(defaults)) {
    controls[name].value = value
    document.querySelector(`#${name}-value`).value = value
  }

  updateResetButton()
  setTexture(createDefaultPortrait())
})

setTexture(createDefaultPortrait())
