// Runs the ASC-52 microphone probe on mic.html. Policy (what counts as which
// verdict) is in mictest.js; this file owns the browser APIs and the timers.

import { describe, rms, speechApi, verdict } from './mictest.js';

const $ = (id) => document.getElementById(id);
const run = Math.random().toString(36).slice(2, 8);
const report = {
  run,
  ua: navigator.userAgent,
  secure: window.isSecureContext,
  hasMediaDevices: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
  speechApi: speechApi(window),
  permission: null,     // navigator.permissions 'microphone' state, before asking
  prompted: null,       // what the person said: did a permission box appear?
  gum: null,            // 'ok' | 'error'
  error: null,
  errorMessage: null,
  devices: null,        // audioinput labels/count after the attempt
  track: null,          // label, muted, readyState, settings
  peak: null,
  speech: null,         // {result} | {error}
  verdict: 'inconclusive',
};

function log(line) {
  $('log').textContent += line + '\n';
}

function show() {
  report.verdict = verdict(report);
  $('verdict').textContent = describe(report.verdict);
}

/** Every step goes to the server log, so the result survives the kitchen. */
function send(step) {
  show();
  fetch('/api/mictest', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ step, ...report }),
  }).catch(() => log('(could not reach the server to record this step)'));
}

async function permissionState() {
  try {
    const p = await navigator.permissions.query({ name: 'microphone' });
    return p.state;
  } catch (e) {
    return `unsupported (${e.name})`;
  }
}

async function listInputs() {
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    const ins = all.filter((d) => d.kind === 'audioinput');
    return { count: ins.length, labels: ins.map((d) => d.label || '(no label)') };
  } catch (e) {
    return { error: e.name };
  }
}

/** Sample the level for `ms`, updating the meter; resolves with the peak RMS. */
function measure(stream, ms) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) {
    log('No AudioContext: cannot measure level.');
    return Promise.resolve(null);
  }
  const ctx = new Ctx();
  const src = ctx.createMediaStreamSource(stream);
  const an = ctx.createAnalyser();
  an.fftSize = 1024;
  src.connect(an);
  const buf = new Uint8Array(an.fftSize);
  let peak = 0;
  return new Promise((done) => {
    const t = setInterval(() => {
      an.getByteTimeDomainData(buf);
      const v = rms(buf);
      peak = Math.max(peak, v);
      $('bar').style.width = `${Math.min(100, v * 400)}%`;
    }, 100);
    setTimeout(() => {
      clearInterval(t);
      $('bar').style.width = '0';
      ctx.close();
      done(Math.round(peak * 1000) / 1000);
    }, ms);
  });
}

async function start() {
  $('start').disabled = true;
  log(`UA: ${report.ua}`);
  log(`secure context: ${report.secure} · getUserMedia: ${report.hasMediaDevices} · speech API: ${report.speechApi}`);
  if (!report.hasMediaDevices) {
    send('no-api');
    return;
  }
  report.permission = await permissionState();
  log(`permission before asking: ${report.permission}`);
  send('begin');
  $('ask').hidden = false;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    report.gum = 'ok';
  } catch (e) {
    report.gum = 'error';
    report.error = e.name;
    report.errorMessage = String(e.message || '').slice(0, 200);
    log(`getUserMedia refused: ${e.name}: ${e.message}`);
  }
  report.devices = await listInputs();
  log(`audio inputs: ${JSON.stringify(report.devices)}`);
  if (!stream) {
    send('gum-error');
    $('start').disabled = false;
    return;
  }
  const tr = stream.getAudioTracks()[0];
  report.track = tr ? { label: tr.label, muted: tr.muted, readyState: tr.readyState, settings: tr.getSettings?.() ?? null } : null;
  log(`got a track: ${JSON.stringify(report.track)}`);
  send('gum-ok');

  log('Listening for 8 s — talk now.');
  report.peak = await measure(stream, 8000);
  for (const t of stream.getTracks()) t.stop();
  log(`peak level: ${report.peak}`);
  send('level');
  $('start').disabled = false;
}

function speech() {
  const name = speechApi(window);
  if (!name) {
    report.speech = { error: 'no API' };
    log('Speech recognition: not available in this browser.');
    send('speech');
    return;
  }
  const rec = new window[name]();
  rec.lang = 'en-US';
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  $('heard').textContent = 'Say something…';
  let final = '';
  rec.onresult = (ev) => {
    const text = Array.from(ev.results).map((r) => r[0].transcript).join(' ');
    $('heard').textContent = `“${text}”`;
    if (ev.results[ev.results.length - 1].isFinal) final = text;
  };
  rec.onerror = (ev) => {
    report.speech = { error: ev.error, message: ev.message || null };
    log(`speech error: ${ev.error}`);
    send('speech');
  };
  rec.onend = () => {
    if (!report.speech || !report.speech.error) {
      report.speech = { result: final || null };
      log(`speech heard: ${final || '(nothing)'}`);
      send('speech');
    }
  };
  report.speech = null;
  try {
    rec.start();
    log(`speech recognition started (${name})`);
  } catch (e) {
    report.speech = { error: e.name };
    log(`speech start failed: ${e.name}`);
    send('speech');
  }
}

$('start').addEventListener('click', start);
$('speech').addEventListener('click', speech);
$('back').addEventListener('click', () => { location.href = '/'; });
for (const b of document.querySelectorAll('[data-prompt]')) {
  b.addEventListener('click', () => {
    report.prompted = b.dataset.prompt === 'yes';
    $('ask').hidden = true;
    log(`permission box appeared: ${b.dataset.prompt}`);
    send('prompted');
  });
}
show();
send('load');
