import http from 'node:http';
import pkg from '@croo-network/sdk';
import { buildDebate } from './debate.js';

const { AgentClient, EventType, DeliverableType } = pkg;

const PORT = process.env.PORT || 3000;
const API_KEY = (process.env.CROO_API_KEY || '').trim();
const config = {
  baseURL: (process.env.CROO_API_URL || '').trim(),
  wsURL: (process.env.CROO_WS_URL || '').trim(),
  rpcURL: (process.env.CROO_RPC_URL || 'https://mainnet.base.org').trim(),
  logger: { debug() {}, info: console.log, warn: console.warn, error: console.error },
};

// ---------- requirement unwrapping ----------
// Requirements can arrive wrapped, e.g. {"text":"<payload>"}, sometimes nested.
function unwrap(v, depth = 0) {
  if (v == null) return '';
  if (typeof v === 'string') {
    const s = v.trim();
    if (depth < 6 && (s.startsWith('{') || s.startsWith('['))) {
      try {
        const inner = unwrapObj(JSON.parse(s), depth + 1);
        if (inner !== null) return inner;
      } catch { /* not JSON, treat as plain text */ }
    }
    return s;
  }
  const inner = unwrapObj(v, depth + 1);
  return inner !== null ? inner : JSON.stringify(v);
}
function unwrapObj(o, depth) {
  if (o && typeof o === 'object' && !Array.isArray(o)) {
    for (const k of ['text', 'requirement', 'requirements', 'input', 'prompt', 'message', 'data', 'content']) {
      if (typeof o[k] === 'string' && o[k].trim()) return unwrap(o[k], depth);
      if (o[k] && typeof o[k] === 'object') return unwrap(o[k], depth);
    }
  }
  return null;
}

function readRequirement(order) {
  for (const k of ['requirement', 'requirements', 'requirementText', 'input', 'data']) {
    const v = order && order[k];
    if (v !== undefined && v !== null && String(typeof v === 'string' ? v : JSON.stringify(v)).trim()) return unwrap(v);
  }
  return '';
}

// ---------- CROO provider ----------
let provider = null;
let connecting = false;
let backoff = 2000;
const handledNeg = new Set();
const handledOrder = new Set();

async function onNegotiation(e) {
  const id = e.negotiation_id ?? e.negotiationId;
  if (!id || handledNeg.has(id)) return;
  handledNeg.add(id);
  try {
    const result = await provider.acceptNegotiation(id);
    console.log('Accepted negotiation', id, 'order', result && result.order && result.order.orderId);
  } catch (err) {
    console.error('Accept error:', err && err.message ? err.message : err);
  }
}

async function onPaid(e) {
  const orderId = e.order_id ?? e.orderId;
  if (!orderId || handledOrder.has(orderId)) return;
  handledOrder.add(orderId);
  let report;
  try {
    const order = await provider.getOrder(orderId);
    const text = readRequirement(order);
    report = buildDebate(text);
  } catch (err) {
    console.error('Analysis error:', err && err.message ? err.message : err);
    report = 'DEBATEARENA: something went wrong while building your debate. Here is a sample debate instead.\n\n' + buildDebate('');
  }
  try {
    await provider.deliverOrder(orderId, { deliverableType: DeliverableType.Text, deliverableText: report });
    console.log('Delivered order', orderId);
  } catch (err) {
    console.error('Delivery error:', err && err.message ? err.message : err);
    handledOrder.delete(orderId); // allow a retry if the event repeats
  }
}

function onCompleted(e) {
  console.log('Order completed', e.order_id ?? e.orderId);
}

function wire(stream) {
  const handlers = {
    [EventType.NegotiationCreated]: onNegotiation,
    [EventType.OrderPaid]: onPaid,
    [EventType.OrderCompleted]: onCompleted,
  };
  try {
    console.log('Stream methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(stream) || {}).join(','));
  } catch { /* diagnostics only */ }
  if (typeof stream.on === 'function') {
    for (const [type, fn] of Object.entries(handlers)) stream.on(type, fn);
    // Fallback: catch-all dispatcher (duplicates are filtered by the handled sets)
    for (const ch of ['event', 'message']) {
      stream.on(ch, (e) => {
        const t = e && (e.type || e.event_type || e.eventType);
        if (t && handlers[t]) handlers[t](e.data && typeof e.data === 'object' ? { ...e.data, ...e } : e);
      });
    }
    stream.on('close', () => { console.warn('CROO WebSocket closed'); scheduleReconnect(); });
    stream.on('error', (err) => console.error('CROO stream error:', err && err.message ? err.message : err));
  } else {
    console.error('Stream has no .on(); check the SDK event API in the veris-agent code.');
  }
}

function scheduleReconnect() {
  connecting = false;
  setTimeout(connect, backoff);
  backoff = Math.min(backoff * 2, 60000);
}

async function connect() {
  if (connecting) return;
  if (!API_KEY) { console.error('CROO_API_KEY missing: provider not started'); return; }
  connecting = true;
  try {
    provider = new AgentClient(config, API_KEY);
    const stream = await provider.connectWebSocket();
    wire(stream);
    console.log('CROO WebSocket connected');
    backoff = 2000;
  } catch (err) {
    console.error('CROO connect error:', err && err.message ? err.message : err);
    scheduleReconnect();
  }
}

// ---------- web server ----------
const TRY_PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DebateArena</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:0 auto;padding:16px}textarea{width:100%;height:110px;box-sizing:border-box;padding:8px}button{padding:10px 18px;margin:8px 0}pre{white-space:pre-wrap;background:#f4f4f4;padding:12px;border-radius:6px;font-size:13px}</style></head>
<body><h2>DebateArena</h2>
<p>Enter a topic or question to debate.</p>
<textarea id="t">Should university education be free for everyone?</textarea><br>
<button id="b">Build my debate</button>
<pre id="o"></pre>
<script>
document.getElementById('b').onclick=async function(){
  var o=document.getElementById('o'); o.textContent='Building...';
  try{
    var r=await fetch('/api/debate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:document.getElementById('t').value})});
    var j=await r.json(); o.textContent=j.report||j.error;
  }catch(e){o.textContent='Error: '+e.message;}
};
</script></body></html>`;

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (req.method === 'GET' && (url === '/' || url === '/health')) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('DebateArena online\n' + (API_KEY ? 'provider key configured' : 'provider key MISSING'));
    return;
  }
  if (req.method === 'GET' && url === '/try') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(TRY_PAGE);
    return;
  }
  if (req.method === 'POST' && url === '/api/debate') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 20000) req.destroy(); });
    req.on('end', () => {
      try {
        const text = unwrap(JSON.parse(body || '{}'));
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ report: buildDebate(text) }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad request' }));
      }
    });
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log('DebateArena listening on', PORT);
  connect();
});

// Keep the free Render instance awake
const SELF = (process.env.RENDER_EXTERNAL_URL || '').trim();
if (SELF) {
  setInterval(() => { fetch(SELF + '/health').catch(() => {}); }, 14 * 60 * 1000);
}
