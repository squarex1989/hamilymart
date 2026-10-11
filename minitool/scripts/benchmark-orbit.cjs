/* Reproducible local Chrome CPU-side draw-submission benchmark.
 * Not GPU completion timing, Xiaohongshu-container acceptance, or real-device FPS.
 * No GPU timer queries, readPixels, finish, getError, or framebuffer readback.
 */
const { chromium } = require(process.env.HAMILY_PLAYWRIGHT || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

const label = process.argv[2] || 'current';
assert(/^[a-zA-Z0-9_-]+$/.test(label), 'Use a simple output label');
const source = path.resolve(process.env.HAMILY_BENCH_DIST || path.join(__dirname, '../dist'));
const output = path.resolve(__dirname, '../generated');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hamily-orbit-'));
fs.cpSync(source, root, { recursive: true });
const config = {
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  rounds: 3, warmupMs: 2000, measureMs: 12000, orbitPeriodMs: 4000,
  safeArea: { top: 44, bottom: 34 }, headless: true, channel: 'chrome',
};
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(directory, entry.name);
    return entry.isDirectory() ? files(absolute) : [absolute];
  }).sort();
}
const buildHash = crypto.createHash('sha256');
for (const file of files(root)) buildHash.update(path.relative(root, file)).update('\0').update(fs.readFileSync(file));
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.webp': 'image/webp' }[path.extname(file)] || 'application/octet-stream');
  res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; object-src 'none'");
  res.end(fs.readFileSync(file));
});
function distribution(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = fraction => {
    const offset = (sorted.length - 1) * fraction, low = Math.floor(offset), high = Math.ceil(offset);
    return sorted[low] + (sorted[high] - sorted[low]) * (offset - low);
  };
  return { count: values.length, min: sorted[0], p50: percentile(.5), p95: percentile(.95), p99: percentile(.99), max: sorted.at(-1), mean: values.reduce((a, b) => a + b, 0) / values.length };
}
function summarize(round) {
  const intervals = round.frames.slice(1).map((frame, index) => frame.firstDrawAt - round.frames[index].firstDrawAt);
  const rafIntervals = round.driverRafTimes.slice(1).map((time, index) => time - round.driverRafTimes[index]);
  const drawRafIntervals = round.frames.slice(1).map((frame, index) => frame.rafTimestamp - round.frames[index].rafTimestamp);
  const resolutionCounts = {};
  for (const frame of round.frames) {
    const key = `${frame.width}x${frame.height}`;
    resolutionCounts[key] = (resolutionCounts[key] || 0) + 1;
  }
  return {
    drawnFrames: round.frames.length,
    submittedFps: intervals.length / (intervals.reduce((a, b) => a + b, 0) / 1000),
    drawsPerMeasuredSecond: round.frames.length / (round.measureElapsedMs / 1000),
    drawSubmissionIntervalMs: distribution(intervals),
    drawnRafIntervalMs: distribution(drawRafIntervals),
    driverRafIntervalMs: distribution(rafIntervals),
    drawCallsPerFrame: distribution(round.frames.map(frame => frame.calls)),
    drawCalls: round.frames.reduce((sum, frame) => sum + frame.calls, 0),
    resolutionCounts,
    effectiveDpr: Object.keys(resolutionCounts).map(value => { const [width, height] = value.split('x').map(Number); return { width, height, dprX: width / round.canvas.cssWidth, dprY: height / round.canvas.cssHeight }; }),
    intervalOver33_4ms: intervals.filter(value => value > 33.4).length,
    intervalOver50ms: intervals.filter(value => value > 50).length,
    outsideRafDrawCalls: round.outsideRafDrawCalls,
  };
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const report = {
    status: 'running', label, recordedAt: new Date().toISOString(), buildSha256: buildHash.digest('hex'), config,
    method: {
      description: 'After complete initial model loading and a settled draw, perform three independent page loads. Each run holds a native mouse pointer down in blank canvas space and dispatches a deterministic elliptical pointermove once per browser animation callback. Exclude 2 s warmup; measure the next 12 s.',
      trajectory: 'Canvas-relative x=.45-.42*cos(2*pi*t/4000), y=.30+.16*sin(2*pi*t/4000). Synthetic moves reuse the actual active mouse pointer ID; down/up are native Playwright mouse events.',
      frameDefinition: 'One submitted frame is one browser requestAnimationFrame timestamp containing at least one real WebGL draw call. All drawElements/drawArrays/instanced calls in that timestamp are counted together. Submission interval uses performance.now at the first real draw, not driver event cadence.',
      limitations: 'CPU-side WebGL submission timestamps are not GPU completion or displayed-frame timestamps. Headless desktop Chrome with a mobile-sized viewport cannot establish Xiaohongshu container or phone performance. Synthetic orbit replay, wrapper overhead, OS scheduling, thermal state, and browser/GPU environment may affect results.',
      gpuSynchronization: 'None: no readPixels, finish, GPU timer query polling, getError, or getParameter calls during measurement. GPU identity comes from CDP SystemInfo before runs; context attributes are read before measurement.',
    },
    environment: { platform: process.platform, arch: process.arch, osRelease: os.release(), cpu: os.cpus()[0]?.model, logicalCpuCount: os.cpus().length, memoryBytes: os.totalmem(), node: process.version },
    rounds: [], errors: [],
  };
  let browser;
  try {
    browser = await chromium.launch({ channel: config.channel, headless: config.headless });
    report.environment.chromeVersion = browser.version();
    const cdp = await browser.newBrowserCDPSession();
    const info = await cdp.send('SystemInfo.getInfo');
    report.environment.gpu = info.gpu;
    report.environment.browserCommandLine = info.commandLine;
    for (let roundIndex = 0; roundIndex < config.rounds; roundIndex++) {
      const page = await browser.newPage({ viewport: config.viewport, deviceScaleFactor: config.deviceScaleFactor, isMobile: config.isMobile, hasTouch: config.hasTouch });
      const modelLoads = [];
      page.on('pageerror', error => report.errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error' && !message.text().includes('404')) report.errors.push(message.text()); });
      page.on('response', response => { if (/\/models\/.*\.js$/.test(response.url())) modelLoads.push({ file: response.url().split('/').pop(), status: response.status() }); });
      await page.addInitScript(({ safeArea }) => {
        const saved = new Map();
        window.xhs = { launchOptions: { miniToolEnv: { buildVersion: 9460000 } }, miniTool: { getStorage: async ({ key }) => ({ data: saved.get(key) || null }), setStorage: async ({ key, data }) => { saved.set(key, data); } } };
        const bench = window.__orbitBench = { contexts: [], activeRaf: null, recording: false, frames: [], outsideRafDrawCalls: 0, pointer: null };
        const raf = window.requestAnimationFrame.bind(window);
        window.requestAnimationFrame = callback => raf(timestamp => {
          const previous = bench.activeRaf;
          bench.activeRaf = timestamp;
          try { callback(timestamp); } finally { bench.activeRaf = previous; }
        });
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (...args) {
          const gl = getContext.apply(this, args);
          if (gl && ['webgl', 'webgl2'].includes(args[0]) && !bench.contexts.some(item => item.gl === gl)) {
            const context = { gl, canvas: this, type: args[0], totalDraws: 0, lastDrawAt: 0 };
            bench.contexts.push(context);
            for (const method of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) if (gl[method]) {
              const draw = gl[method].bind(gl);
              gl[method] = (...parameters) => {
                context.totalDraws++;
                if (bench.recording && context.canvas === bench.canvas) {
                  if (bench.activeRaf === null) bench.outsideRafDrawCalls++;
                  else {
                    let frame = bench.frames[bench.frames.length - 1];
                    if (!frame || frame.rafTimestamp !== bench.activeRaf) {
                      frame = { rafTimestamp: bench.activeRaf, firstDrawAt: performance.now(), calls: 0, width: this.width, height: this.height };
                      bench.frames.push(frame);
                    }
                    frame.calls++;
                  }
                } else context.lastDrawAt = performance.now();
                return draw(...parameters);
              };
            }
          }
          return gl;
        };
        addEventListener('pointerdown', event => { bench.pointer = { pointerId: event.pointerId, pointerType: event.pointerType, isPrimary: event.isPrimary }; }, true);
        addEventListener('DOMContentLoaded', () => {
          document.documentElement.style.setProperty('--safe-area-inset-top', `${safeArea.top}px`);
          document.documentElement.style.setProperty('--safe-area-inset-bottom', `${safeArea.bottom}px`);
        });
      }, { safeArea: config.safeArea });
      await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
      await page.waitForFunction(() => {
        const canvas = document.querySelector('.scene-canvas canvas');
        const context = window.__orbitBench.contexts.find(item => item.canvas === canvas);
        return context && context.totalDraws > 0 && !document.querySelector('.scene-loading') && performance.now() - context.lastDrawAt >= 650;
      }, null, { timeout: 30000 });
      assert(modelLoads.length >= 15 && modelLoads.every(item => item.status === 200), 'Initial models must load completely');
      const initial = await page.evaluate(() => {
        const canvas = document.querySelector('.scene-canvas canvas');
        const box = canvas.getBoundingClientRect();
        const context = window.__orbitBench.contexts.find(item => item.canvas === canvas);
        return { cssWidth: box.width, cssHeight: box.height, left: box.left, top: box.top, width: canvas.width, height: canvas.height, contextType: context.type, attributes: context.gl.getContextAttributes(), devicePixelRatio, userAgent: navigator.userAgent };
      });
      await page.mouse.move(initial.left + initial.cssWidth * .03, initial.top + initial.cssHeight * .30);
      await page.mouse.down();
      let measured;
      try {
        measured = await page.evaluate(({ warmupMs, measureMs, orbitPeriodMs }) => new Promise(resolve => {
          const bench = window.__orbitBench;
          const canvas = bench.canvas = document.querySelector('.scene-canvas canvas');
          const box = canvas.getBoundingClientRect();
          const startedAt = performance.now();
          let measuredAt;
          const driverRafTimes = [];
          function step(timestamp) {
            const now = performance.now(), elapsed = now - startedAt;
            if (!bench.recording && elapsed >= warmupMs) { bench.recording = true; measuredAt = now; }
            if (bench.recording && now - measuredAt >= measureMs) {
              bench.recording = false;
              resolve({ frames: bench.frames, driverRafTimes, outsideRafDrawCalls: bench.outsideRafDrawCalls, measureElapsedMs: now - measuredAt, actualWarmupMs: measuredAt - startedAt, pointer: bench.pointer });
              return;
            }
            if (bench.recording) driverRafTimes.push(timestamp);
            const phase = 2 * Math.PI * elapsed / orbitPeriodMs;
            canvas.dispatchEvent(new PointerEvent('pointermove', { ...bench.pointer, bubbles: true, cancelable: true, composed: true, buttons: 1, button: -1, pressure: .5,
              clientX: box.left + box.width * (.45 - .42 * Math.cos(phase)), clientY: box.top + box.height * (.30 + .16 * Math.sin(phase)) }));
            requestAnimationFrame(step);
          }
          requestAnimationFrame(step);
        }), config);
      } finally { await page.mouse.up(); }
      assert(measured.frames.length > 100, 'Orbit must submit enough real frames');
      assert.equal(measured.outsideRafDrawCalls, 0, 'Unexpected non-animation-frame rendering needs a different frame definition');
      const round = { index: roundIndex + 1, canvas: initial, modelLoads, ...measured };
      round.summary = summarize(round);
      report.rounds.push(round);
      console.log(JSON.stringify({ round: round.index, summary: round.summary }));
      await page.close();
    }
    assert.equal(report.errors.length, 0, report.errors.join('\n'));
    report.aggregate = {
      medianRoundFps: distribution(report.rounds.map(round => round.summary.submittedFps)).p50,
      submittedFpsAcrossRounds: distribution(report.rounds.map(round => round.summary.submittedFps)),
      pooledDrawSubmissionIntervalMs: distribution(report.rounds.flatMap(round => round.frames.slice(1).map((frame, index) => frame.firstDrawAt - round.frames[index].firstDrawAt))),
      pooledDrawCallsPerFrame: distribution(report.rounds.flatMap(round => round.frames.map(frame => frame.calls))),
      resolutionCounts: report.rounds.map(round => round.summary.resolutionCounts),
    };
    report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.failure = error.stack || String(error); process.exitCode = 1; }
  finally {
    const destination = path.join(output, `orbit-benchmark-${label}.json`);
    fs.writeFileSync(destination, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ status: report.status, report: destination, aggregate: report.aggregate, failure: report.failure }));
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})();
