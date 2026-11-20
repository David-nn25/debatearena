import assert from 'node:assert';
import { buildDebate, parseTopic } from './debate.js';

const topics = [
  'Should university education be free for everyone?',
  'Is remote work better than office work?',
  'Social media does more harm than good',
  'Cats vs dogs',
  'Should we ban plastic bags?',
  'Does sugar tax reduce obesity?',
  'Create a debate on whether football should use VAR',
  'Is it ethical to eat meat?',
  'Nigeria should adopt a four-day work week',
  '',
];

for (const t of topics) {
  const out = buildDebate(t);
  for (const s of ['[3] OPENING STATEMENTS', '[4] CASE FOR', '[6] REBUTTALS', '[7] CROSS-EXAMINATION', '[8] FALLACY WATCH', '[9] CLOSING STATEMENTS', '[10] VERDICT', 'TOTAL (out of 20)']) {
    assert.ok(out.includes(s), 'missing ' + s + ' for: ' + t);
  }
  assert.ok(!/undefined|NaN|\[object|null/.test(out), 'bad value for: ' + t);
  assert.ok(!/[^\x00-\x7F]/.test(out), 'non-ASCII for: ' + t);
  assert.strictEqual(buildDebate(t), out, 'not deterministic');
}

assert.strictEqual(parseTopic('Should university education be free for everyone?').type, 'policy');
assert.strictEqual(parseTopic('Should university education be free for everyone?').np, 'university education');
assert.strictEqual(parseTopic('Is remote work better than office work?').type, 'comparison');
assert.strictEqual(parseTopic('Cats vs dogs').A, 'Cats');
assert.strictEqual(parseTopic('Social media does more harm than good').type, 'claim');
assert.strictEqual(parseTopic('Should we ban plastic bags?').np, 'plastic bags');
console.log('All tests passed');
