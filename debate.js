// DebateArena engine: deterministic debate-script generator.
// No LLM, no API, no database. Same topic -> same script.
// It builds argument skeletons (claims, reasoning, evidence to look for, weak points),
// not statistics. It never invents facts or figures.

const DOMAINS = {
  education: {
    re: /\b(universit\w*|school\w*|students?|education\w*|tuition|college\w*|teachers?|curricul\w*|exams?|learning|degrees?)\b/i,
    s: ['students', 'parents', 'teachers', 'institutions'],
    ev: 'enrolment and graduation data, funding records and employment outcomes',
  },
  tech: {
    re: /\b(technolog\w*|ai|artificial intelligence|social media|internet|apps?|online|digital|data|privacy|robots?|algorithms?|crypto\w*|phones?|smartphones?|automation)\b/i,
    s: ['users', 'technology companies', 'regulators', 'developers'],
    ev: 'usage data, security reports and independent audits',
  },
  economy: {
    re: /\b(jobs?|work\w*|salar\w*|wages?|tax\w*|economy|economic|business\w*|trade|prices?|income|employ\w*|remote|compan\w*|markets?|poverty|inflation|minimum wage)\b/i,
    s: ['workers', 'employers', 'consumers', 'government'],
    ev: 'labour-market data, productivity studies and budget figures',
  },
  health: {
    re: /\b(health\w*|medic\w*|hospitals?|vaccin\w*|drugs?|doctors?|disease\w*|mental|diets?|sugar|smok\w*|alcohol|fitness)\b/i,
    s: ['patients', 'clinicians', 'public health bodies', 'insurers'],
    ev: 'clinical studies, health outcome statistics and cost data',
  },
  environment: {
    re: /\b(climate|environment\w*|plastics?|pollution|energy|carbon|renewables?|fossil|recycl\w*|wildlife|farming|agricultur\w*)\b/i,
    s: ['local communities', 'industry', 'future generations', 'regulators'],
    ev: 'emissions and impact data, lifecycle analyses and monitoring reports',
  },
  governance: {
    re: /\b(laws?|government\w*|police|voting|vote|elections?|courts?|prisons?|democracy|military|constitution\w*|immigration|citizens?|crime|death penalty|censorship|term limits?)\b/i,
    s: ['citizens', 'courts', 'minority groups', 'lawmakers'],
    ev: 'legal precedents, comparative country data and official statistics',
  },
  society: {
    re: /\b(family|families|marriage|children|parents?|culture|religio\w*|gender|youth|community|communities|tradition\w*|society|social)\b/i,
    s: ['families', 'young people', 'communities', 'institutions'],
    ev: 'surveys, long-term studies and community case studies',
  },
  sport: {
    re: /\b(sports?|football|soccer|athletes?|leagues?|olympic\w*|players?|referees?|basketball)\b/i,
    s: ['athletes', 'fans', 'clubs', 'sponsors'],
    ev: 'performance data, fan surveys and records of past rule changes',
  },
  general: {
    re: /$^/,
    s: ['individuals', 'communities', 'businesses', 'government'],
    ev: 'credible studies, official statistics and comparable case studies',
  },
};

// ---------- helpers ----------
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(seed) {
  const r = mulberry32(seed);
  return {
    shuffle: (arr) => { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
  };
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const lc = (s) => s.charAt(0).toLowerCase() + s.slice(1);
const noDot = (s) => s.replace(/[.!?]+$/, '');
const ascii = (s) => s.replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"').replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...');

// ---------- topic parsing ----------
const POLICY_VERBS = 'ban|abolish|legali[sz]e|introduce|allow|make|require|stop|end|raise|lower|tax|fund|restrict|regulate|outlaw|criminali[sz]e|scrap|adopt|limit|mandate|replace|cancel';
const MARKERS = /\b(be|become|have|stop|start|get|receive|pay|replace|ban|allow|use|include|require|remain|continue|do|take|keep|give|provide|offer|adopt|introduce|cause|causes|lead|leads|make|makes|help|helps|harm|harms|improve|improves|reduce|reduces|increase|increases|does|do|is|are|will|can|has|have)\b/i;

export function parseTopic(raw) {
  let t = String(raw || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(?:please\s+)?(?:(?:create|generate|write|build|make|give me)\s+(?:me\s+)?(?:a\s+)?debate\s*(?:script)?\s*(?:on|about|for|over)?|debate|topic|motion|argue|discuss)\s*[:\-]?\s*/i, '');
  t = t.replace(/^(?:on|about)\s+/i, '').replace(/^["']|["']$/g, '').trim();
  t = t.replace(/^whether\s+/i, 'Does ');
  const q = t.match(/^[^?]*\?/);
  t = (q ? q[0] : t.split(/(?<=[.!])\s/)[0]).slice(0, 220).trim();
  const topic = t;
  const out = { topic, type: 'claim', np: null, npClean: false, A: null, B: null };
  if (!topic) return out;

  // comparison
  let cm = topic.match(/^(.*?)\s+(?:vs\.?|versus)\s+(.*?)\??$/i);
  if (!cm) cm = topic.match(/^(?:is|are|does|do)?\s*(.*?)\s+(?:better|worse|safer|cheaper|healthier|faster|easier)\s+than\s+(.*?)\??$/i);
  if (cm && cm[1].trim() && cm[2].trim()) {
    out.type = 'comparison';
    out.A = cm[1].trim().replace(/^(?:is|are)\s+/i, '');
    out.B = cm[2].trim();
    return out;
  }

  const body = topic.replace(/\?$/, '').trim();
  const should = body.match(/^(?:should|must)\s+(.+)$/i) || body.match(/^(.+?)\s+(?:should|must|ought to)\s+(.+)$/i);
  const imperative = body.match(new RegExp('^(?:we\\s+|the government\\s+)?(?:' + POLICY_VERBS + ')\\b\\s*(.*)$', 'i'));
  if (should || imperative) {
    out.type = 'policy';
    const verbObj = new RegExp('^(?:' + POLICY_VERBS + ')\\s+(.+)$', 'i');
    const clip = (x) => x.trim().split(' ').slice(0, 5).join(' ');
    if (should && should.length === 3) {
      // subject-first form: "X should <verb> Y"
      const vo = should[2].match(verbObj);
      out.np = clip(vo ? vo[1] : should[1]); out.npClean = true;
      return out;
    }
    let rest = should ? should[1] : body;
    rest = rest.replace(/^(?:we|they|people|the government|governments?)\s+/i, '');
    const vo = rest.match(verbObj);
    const m = rest.match(MARKERS);
    if (vo) {
      out.np = clip(vo[1]); out.npClean = true;
    } else if (m && m.index > 0 && rest.slice(0, m.index).trim().split(' ').length <= 5) {
      out.np = rest.slice(0, m.index).trim(); out.npClean = true;
    } else if (rest.split(' ').length <= 5) {
      out.np = rest; out.npClean = true;
    }
    return out;
  }

  // claim
  const stripped = body.replace(/^(?:is|are|does|do|will|can|could|would|has|have|was|were)\s+/i, '');
  const m = stripped.match(MARKERS);
  if (m && m.index > 0 && stripped.slice(0, m.index).trim().split(' ').length <= 5) {
    out.np = stripped.slice(0, m.index).trim(); out.npClean = true;
  } else if (stripped.split(' ').length <= 4) {
    out.np = stripped; out.npClean = true;
  }
  return out;
}

function detectDomain(text) {
  let best = null;
  for (const [id, d] of Object.entries(DOMAINS)) {
    if (id === 'general') continue;
    const m = text.match(d.re);
    if (m && (best === null || m.index < best.idx)) best = { id, idx: m.index };
  }
  return best ? best.id : 'general';
}

// ---------- argument lenses ----------
// Each lens returns the Proposition (pro) and Opposition (con) argument for it.
function policyLenses(c) {
  const { np, ap, s, ev } = c;
  return [
    {
      key: 'Fairness',
      pro: { claim: 'It makes outcomes fairer for ' + s[0] + ' and ' + s[1] + '.', why: 'Right now, who benefits from ' + np + ' depends heavily on starting position rather than need or effort. Changing the rule removes that built-in advantage and widens real access.', ev: 'Access and participation figures across different backgrounds; ' + ev + '.', weak: 'Fairness claims must show the change reaches the people it is meant to help, not those already well placed.' },
      con: { claim: 'It swaps one unfairness for another.', why: 'Any change to ' + np + ' creates winners and losers. Opponents argue the costs fall on ' + s[2] + ' and ' + s[1] + ' who did not choose them, while the gains flow to people already able to use them.', ev: 'Distribution data showing who pays and who gains; ' + ev + '.', weak: 'Pointing to unfairness in the reform is weak if the status quo is shown to be more unfair.' },
      qToPro: 'How will you make sure the benefit reaches the people who need it most and not the ones already well placed?',
      qToCon: 'If ' + ap + ' is fair, why do outcomes differ so much between ' + s[0] + ' and ' + s[1] + '?',
    },
    {
      key: 'Cost and benefit',
      pro: { claim: 'The long-run benefits outweigh the upfront costs.', why: 'Proponents argue that effort or money spent on ' + np + ' now pays back through better outcomes for ' + s[0] + ' and ' + s[3] + '. A short-term price is not the same as a bad investment.', ev: 'Cost-benefit analyses and pilot results; ' + ev + '.', weak: 'Projected returns are uncertain and often optimistic; the case must survive changes in its assumptions.' },
      con: { claim: 'The costs are real, immediate and likely underestimated.', why: 'Opponents argue that reforms to ' + np + ' rarely cost what the plan says, that someone must pay, and that the same resources could do more good elsewhere.', ev: 'Overruns on comparable reforms; the value of the best alternative use of the same resources.', weak: 'Cost arguments lose force if the benefit side shows large, credible savings elsewhere.' },
      qToPro: 'Who pays, how much, and what happens if your estimate is wrong?',
      qToCon: 'What does doing nothing cost, and who carries that cost?',
    },
    {
      key: 'Practicality',
      pro: { claim: 'It can be done, and the risks can be managed.', why: 'A phased rollout, clear rules and monitoring let ' + s[3] + ' and ' + s[1] + ' adapt. Supporters point to pilots or partial versions of ' + np + ' that already work.', ev: 'Case studies of pilot or partial versions; implementation timelines.', weak: 'The claim that it worked somewhere else is weak if conditions there were very different.' },
      con: { claim: 'It is harder to deliver than supporters admit.', why: 'Change in ' + np + ' depends on institutions, capacity and enforcement. Opponents argue that weak execution can erase the benefits and create new problems such as delays, loopholes or lower quality.', ev: 'Implementation failures of similar reforms; capacity assessments.', weak: 'Difficulty argues for better design, not automatically against the goal.' },
      qToPro: 'What is your rollout plan, and who enforces it?',
      qToCon: 'If delivery is the real problem, what design would you accept?',
    },
    {
      key: 'Freedom and choice',
      pro: { claim: 'It expands real choice and individual freedom.', why: 'By removing a barrier around ' + np + ', people can decide based on their goals instead of their constraints. Freedom that exists only on paper is not freedom in practice.', ev: 'Surveys of choices people say they cannot currently make.', weak: 'More choice for some is a weak argument if it brings costs onto others.' },
      con: { claim: 'It limits choice or forces a one-size-fits-all rule.', why: 'Opponents argue that a uniform rule on ' + np + ' overrides the different needs of ' + s[0] + ' and ' + s[2] + ', and that flexible, local or voluntary solutions respect autonomy better.', ev: 'Examples where flexible approaches matched or beat uniform rules.', weak: 'Choice arguments weaken where the current system already limits choice for many.' },
      qToPro: 'Which choices does this remove, and for whom?',
      qToCon: 'Which choices do people lack today that your position leaves unchanged?',
    },
    {
      key: 'Long-term risk',
      pro: { claim: 'Doing nothing carries its own risk.', why: 'The status quo around ' + np + ' is not neutral. Proponents argue that delay compounds problems for ' + s[0] + ' and ' + s[3] + ', and that a well-designed change reduces long-term risk.', ev: 'Trend data on the problem if left alone; projections under both paths.', weak: 'Trend projections are often wrong; the problem must be shown to be real now.' },
      con: { claim: 'Unintended consequences could outweigh the gains.', why: 'Big changes to ' + np + ' alter incentives. Opponents argue that people and institutions adapt in unexpected ways, and that hard-to-reverse moves deserve caution.', ev: 'Documented side effects of similar changes; whether the policy can be reversed.', weak: 'Caution can become an excuse never to act; the cost of waiting must be weighed too.' },
      qToPro: 'If it has side effects, what is your plan, and can it be reversed?',
      qToCon: 'At what point would the cost of waiting justify acting?',
    },
    {
      key: 'Evidence and precedent',
      pro: { claim: 'The evidence and precedent point in its favour.', why: 'Supporters argue that comparable approaches to ' + np + ' have delivered gains, and that critics should explain why this case would be different.', ev: 'Comparative studies across regions, institutions or time periods.', weak: 'Selective examples can mislead; look for counterexamples.' },
      con: { claim: 'The evidence is mixed or does not transfer.', why: 'Opponents argue that results from elsewhere depend on context, that correlation is being mistaken for causation, and that the claimed benefits for ' + np + ' are not yet proven.', ev: 'Studies with proper comparison groups; failed or reversed attempts.', weak: 'Imperfect evidence does not prove the policy would fail.' },
      qToPro: 'Which comparable attempts failed, and why would yours differ?',
      qToCon: 'What evidence would change your mind?',
    },
  ];
}

function claimLenses(c) {
  const { np, s, ev } = c;
  return [
    {
      key: 'Mechanism',
      pro: { claim: 'There is a clear mechanism that makes it true.', why: 'Supporters can explain step by step how ' + np + ' produces the effect described, which makes the claim more than a coincidence.', ev: 'Studies that isolate the mechanism; expert explanations.', weak: 'A plausible mechanism is not proof; it still has to be tested.' },
      con: { claim: 'The proposed mechanism is weak or missing.', why: 'Critics argue that no convincing step-by-step link has been shown between ' + np + ' and the claimed effect, so the claim rests on assumption.', ev: 'Tests of the mechanism that failed; competing explanations.', weak: 'Not knowing the mechanism does not disprove an effect.' },
      qToPro: 'Can you walk through, step by step, how the effect happens?',
      qToCon: 'If there is no link, how do you explain the pattern people observe?',
    },
    {
      key: 'Weight of evidence',
      pro: { claim: 'The weight of evidence supports it.', why: 'Supporters argue that independent sources, using different methods, point the same way on ' + np + '. Agreement across methods is harder to dismiss.', ev: 'Reviews and meta-analyses; ' + ev + '.', weak: 'Many weak studies do not add up to a strong one.' },
      con: { claim: 'The evidence is weaker than it looks.', why: 'Critics argue that the studies on ' + np + ' are small, biased towards positive results or not comparable, so confidence is overstated.', ev: 'Sample sizes, study design and replication attempts.', weak: 'Pointing at flaws is not enough; critics need evidence of the opposite.' },
      qToPro: 'Which is your single strongest study, and what are its limits?',
      qToCon: 'Which evidence would you accept as convincing?',
    },
    {
      key: 'Size of the effect',
      pro: { claim: 'The effect is large enough to matter.', why: 'Even small effects on ' + s[0] + ' and ' + s[1] + ' become important when they apply to many people over a long time.', ev: 'Effect sizes and population-level estimates.', weak: 'A large total can hide a tiny effect per person.' },
      con: { claim: 'Even if true, the effect is small or limited.', why: 'Critics argue that the effect of ' + np + ' is modest next to other factors, so treating it as a headline cause is misleading.', ev: 'Comparisons of effect size with other known factors.', weak: 'Small effects can still matter at scale.' },
      qToPro: 'How big is the effect compared with other factors?',
      qToCon: 'At what size would you accept the effect matters?',
    },
    {
      key: 'Other explanations',
      pro: { claim: 'Other explanations have been tested and fall short.', why: 'Supporters argue that once other factors are controlled for, the link involving ' + np + ' remains, which points to a real connection.', ev: 'Studies that control for confounding factors.', weak: 'Controlling for known factors does not rule out unknown ones.' },
      con: { claim: 'Other factors explain the pattern better.', why: 'Critics argue that what looks like an effect of ' + np + ' is better explained by something else, such as who is affected, timing or a shared cause.', ev: 'Alternative explanations with comparable support.', weak: 'Offering a rival explanation is not the same as showing it is better.' },
      qToPro: 'Which alternative explanation did you rule out, and how?',
      qToCon: 'Which alternative explanation fits all the evidence, not just part of it?',
    },
    {
      key: 'Exceptions',
      pro: { claim: 'Exceptions are rare and can be explained.', why: 'Supporters argue that a general pattern involving ' + np + ' can hold even with exceptions, as long as the exceptions have a clear reason.', ev: 'Breakdowns showing how common the exceptions are.', weak: 'Explaining every exception away can make a claim impossible to test.' },
      con: { claim: 'Clear counterexamples undermine the claim.', why: 'Critics argue that if there are solid cases where ' + np + ' does not behave as claimed, the claim is overstated and needs conditions.', ev: 'Well-documented counterexamples.', weak: 'A few exceptions do not disprove a general trend.' },
      qToPro: 'What would count as a counterexample for you?',
      qToCon: 'Are your counterexamples typical or unusual?',
    },
    {
      key: 'Definitions',
      pro: { claim: 'On the most reasonable definition, it holds.', why: 'Supporters argue that when the key terms around ' + np + ' are defined the way most people and experts use them, the claim is accurate.', ev: 'Standard definitions used in the field.', weak: 'Choosing a convenient definition can make a claim true by default.' },
      con: { claim: 'It only holds under a loose or selective definition.', why: 'Critics argue that the claim about ' + np + ' needs vague or stretched terms to work, and that under a stricter definition it fails.', ev: 'Alternative definitions and how results change under them.', weak: 'Arguing about definitions can dodge the substance.' },
      qToPro: 'How exactly are you defining the key terms?',
      qToCon: 'Which definition would you accept, and does the claim hold under it?',
    },
  ];
}

function comparisonLenses(c) {
  const { s, ev } = c;
  // returns lenses with function-style arguments for (X better than Y)
  const mk = (key, claim, why, evd, weak, q) => ({
    key,
    arg: (X, Y) => ({ claim: claim(X, Y), why: why(X, Y), ev: evd(X, Y), weak: weak(X, Y) }),
    q,
  });
  return [
    mk('Value for effort', (X) => X + ' delivers more value for what it costs.', (X, Y) => 'Compared with ' + Y + ', ' + X + ' gives more for the money, time or effort put in. Supporters argue the gap shows up first for ' + s[0] + ' and ' + s[1] + '.', () => 'Like-for-like cost and results comparisons; ' + ev + '.', (X, Y) => 'Costs of ' + Y + ' may be falling, or hidden costs of ' + X + ' may be missing.', (X, Y) => 'Which costs of ' + X + ' are you leaving out of the comparison with ' + Y + '?'),
    mk('Quality of outcomes', (X) => X + ' produces better results.', (X, Y) => 'When judged on outcomes rather than habit, ' + X + ' comes out ahead of ' + Y + '. Better results compound over time.', () => 'Outcome studies using the same measures for both options.', (X, Y) => 'Results depend on who uses ' + X + '; the comparison with ' + Y + ' may not be fair.', (X, Y) => 'On which outcome measure does ' + Y + ' beat ' + X + ', and how much does it matter?'),
    mk('Flexibility and fit', (X) => X + ' fits more people\'s needs.', (X, Y) => 'Different people and situations need different things. Supporters of ' + X + ' argue it adapts better than ' + Y + ' to ' + s[0] + ' and ' + s[2] + '.', () => 'Surveys of what different users actually need.', (X, Y) => 'Fit varies; ' + Y + ' may suit the largest group better.', (X, Y) => 'For whom would ' + Y + ' clearly be the better choice?'),
    mk('Risk and reliability', (X) => X + ' is the safer, more reliable choice.', (X, Y) => 'When things go wrong, ' + X + ' tends to fail more gently than ' + Y + '. Reliability matters most when the stakes are high.', () => 'Failure and incident records for both options.', (X, Y) => 'Past reliability does not guarantee future reliability, and ' + Y + ' may be improving faster.', (X, Y) => 'What is the worst realistic outcome of ' + X + ' compared with ' + Y + '?'),
    mk('Long-term outlook', (X) => X + ' is better placed for the future.', (X, Y) => 'Trends in ' + s[3] + ' and ' + s[0] + ' favour ' + X + ' over ' + Y + '. Choices made now should suit where things are heading.', () => 'Trend data and credible projections.', (X, Y) => 'Forecasts often fail; ' + Y + ' could adapt.', (X, Y) => 'What would have to change for ' + Y + ' to overtake ' + X + '?'),
  ];
}

// ---------- fallacy watch ----------
function fallacies(type, c) {
  const { np, ap, s } = c;
  const P = [
    { name: 'Bandwagon', ex: '"Everyone else is already doing this, so we should too."', why: 'Popularity is not proof that it works here.', better: 'Name specific cases where it worked and explain why they match this one.' },
    { name: 'False dilemma', ex: '"Either we do this or ' + s[0] + ' are abandoned."', why: 'It ignores middle options.', better: 'Show why the alternatives fall short, one by one.' },
    { name: 'Hasty generalisation', ex: '"It worked in one place, so it will work everywhere."', why: 'One case cannot cover different conditions.', better: 'Show the conditions are comparable, or adjust the claim.' },
  ];
  const O = [
    { name: 'Slippery slope', ex: '"If we change ' + np + ' now, it will not stop there and things will spiral."', why: 'It assumes a chain of events without evidence.', better: 'Name the specific mechanism by which one step leads to the next.' },
    { name: 'Appeal to tradition', ex: '"We have always done it this way, so it must be right."', why: 'Longevity is not a reason it works well.', better: 'Show the current approach delivers good results.' },
    { name: 'Straw man', ex: '"They want to throw everything out and start from nothing."', why: 'It attacks an extreme version nobody proposed.', better: 'Respond to the strongest form of the proposal.' },
  ];
  if (type === 'claim') {
    P[0] = { name: 'Post hoc reasoning', ex: '"It came first and the effect came after, so it caused it."', why: 'Sequence is not cause.', better: 'Show the link survives controls and has a mechanism.' };
    O[0] = { name: 'Anecdotal evidence', ex: '"I know someone for whom this was not true, so the claim is false."', why: 'One story cannot refute a pattern.', better: 'Use representative data, not single cases.' };
  }
  if (type === 'comparison') {
    P[0] = { name: 'Cherry-picking', ex: '"Look at the one measure where ours wins."', why: 'It hides the measures where it loses.', better: 'Say which criteria matter most and why.' };
    O[0] = { name: 'Moving the goalposts', ex: '"That does not count, the real test is something else."', why: 'It changes the standard after the fact.', better: 'Agree the criteria before comparing.' };
  }
  return { P, O };
}

// ---------- scoring ----------
function score(topic, type) {
  const abs = topic.match(/\b(everyone|everybody|all|always|never|ban|banned|abolish\w*|free|every|must|mandatory|completely|entirely|zero|nobody|forever|only|none)\b/gi) || [];
  const hedge = topic.match(/\b(some|limited?|partly|partial|reform\w*|allow\w*|optional|reduce\w*|improve\w*|pilot|gradual\w*|means-tested|certain|sometimes|can|may|often)\b/gi) || [];
  const value = topic.match(/\b(moral\w*|ethic\w*|rights?|unfair|fair|just|justice|dignity)\b/gi) || [];
  const universal = /\b(all|always|never|only|nobody|none|every|everyone)\b/i.test(topic);
  const P = { Clarity: 3, Evidence: 3, Rebuttal: 3, Overreach: 3 };
  const O = { Clarity: 3, Evidence: 3, Rebuttal: 3, Overreach: 3 };
  const why = [];
  if (abs.length >= 1 && type !== 'comparison') {
    P.Overreach -= 1;
    why.push('Absolute wording ("' + abs[0].toLowerCase() + '") raises the Proposition\'s burden: it has to defend every case, not just typical ones.');
    if (abs.length >= 2) { P.Evidence -= 1; why.push('Several absolute terms mean the Proposition needs broad evidence, which is harder to supply.'); }
  }
  if (hedge.length >= 1 && abs.length === 0) {
    P.Overreach += 1; P.Clarity += 1;
    why.push('Qualified wording ("' + hedge[0].toLowerCase() + '") keeps the Proposition\'s claim narrow and easier to defend.');
  }
  if (value.length >= 1) {
    P.Clarity -= 1; O.Clarity -= 1;
    why.push('Value-laden wording ("' + value[0].toLowerCase() + '") means each side may weigh the same facts differently, which lowers clarity for both.');
  }
  if (type === 'claim' && universal) {
    O.Rebuttal += 1;
    why.push('A universal claim can fall to a single solid counterexample, which helps the Opposition\'s rebuttal.');
  }
  if (type === 'comparison') why.push('Comparison motions turn on which criteria matter, so both sides are judged mainly on how well they justify their criteria.');
  if (why.length === 0) why.push('The wording is neutral, so neither side starts with a structural advantage.');
  const clamp = (o) => { for (const k of Object.keys(o)) o[k] = Math.max(1, Math.min(5, o[k])); };
  clamp(P); clamp(O);
  const tp = P.Clarity + P.Evidence + P.Rebuttal + P.Overreach;
  const to = O.Clarity + O.Evidence + O.Rebuttal + O.Overreach;
  return { P, O, tp, to, why };
}

// ---------- builder ----------
export function buildDebate(raw) {
  const empty = !String(raw || '').trim();
  const parsed = parseTopic(empty ? 'Should university education be free for everyone?' : raw);
  const topic = parsed.topic || 'Should university education be free for everyone?';
  const seed = fnv1a(topic.toLowerCase());
  const { shuffle } = makeRng(seed);
  const id = 'DA-' + seed.toString(16).toUpperCase().padStart(8, '0').slice(0, 4);
  const type = parsed.type;
  const domainId = detectDomain(topic);
  const D = DOMAINS[domainId];
  const np = parsed.npClean && parsed.np ? parsed.np : 'this issue';
  const ap = 'the current approach to ' + np;
  const c = { np, ap, s: D.s, ev: D.ev };

  let sideP, sideO, stanceP, stanceO, lensList, argsP = [], argsO = [], qP = [], qO = [];
  if (type === 'comparison') {
    const A = parsed.A, B = parsed.B;
    sideP = 'Team A (for ' + A + ')'; sideO = 'Team B (for ' + B + ')';
    stanceP = A + ' is the better option'; stanceO = B + ' is the better option';
    lensList = shuffle(comparisonLenses(c)).slice(0, 4);
    for (const L of lensList) {
      argsP.push({ key: L.key, ...L.arg(A, B) }); argsO.push({ key: L.key, ...L.arg(B, A) });
      qP.push(L.q(B, A)); qO.push(L.q(A, B));
    }
  } else {
    const isPolicy = type === 'policy';
    sideP = 'Proposition (says YES)'; sideO = 'Opposition (says NO)';
    stanceP = isPolicy ? 'the proposal should go ahead' : 'the claim is true';
    stanceO = isPolicy ? 'the proposal should not go ahead as it stands' : 'the claim is false or overstated';
    lensList = shuffle(isPolicy ? policyLenses(c) : claimLenses(c)).slice(0, 4);
    for (const L of lensList) {
      argsP.push({ key: L.key, ...L.pro }); argsO.push({ key: L.key, ...L.con });
      qP.push(L.qToCon); qO.push(L.qToPro); // questions each side asks the other
    }
  }

  const L = [];
  const bar = '=====================================================';
  const sub = '-----------------------------------------------------';
  const typeName = type === 'policy' ? 'Policy (should we do it?)' : type === 'comparison' ? 'Comparison (which is better?)' : 'Claim (is it true?)';
  L.push(bar, 'DEBATEARENA SCRIPT ' + id, bar);
  if (empty) L.push('NOTE: No topic was supplied, so a sample debate was generated. Send a topic or question for a tailored script.', '');
  L.push('MOTION: ' + topic);
  L.push('TYPE: ' + typeName + '   DOMAIN: ' + cap(domainId) + '   FORMAT: opening, arguments, rebuttals, cross-examination, closing, verdict');
  L.push('SIDES: ' + sideP + ' vs ' + sideO);
  L.push('NOTE: This is a structured argument skeleton for practice. It gives claims, reasoning and the kinds of evidence to look for. It does not state facts or figures about the topic.', '');

  L.push('[1] DEFINE BEFORE YOU DEBATE', sub);
  L.push('- Scope: who and what exactly does the motion cover?');
  L.push('- Baseline: compared with what is each side arguing (the status quo, or a specific alternative)?');
  L.push('- Success: what outcome would each side accept as proof it is right?');
  L.push('Stakeholders in play: ' + D.s.join(', ') + '.', '');

  L.push('[2] COMMON GROUND', sub);
  L.push('- Both sides want good outcomes for ' + D.s[0] + ' and ' + D.s[1] + '.');
  L.push('- Both sides accept that evidence should settle disputed facts.');
  L.push('- The real disagreement is about ' + (type === 'comparison' ? 'which criteria matter most.' : type === 'policy' ? 'whether the benefits justify the costs and risks.' : 'how strong the evidence is and what it shows.'), '');

  const open = (args, stance) => 'We argue that ' + stance + '. Our case rests on three points. First, ' + lc(noDot(args[0].claim)) + '. Second, ' + lc(noDot(args[1].claim)) + '. Third, ' + lc(noDot(args[2].claim)) + '.';

  L.push('[3] OPENING STATEMENTS', sub);
  L.push(sideP + ': "' + open(argsP, stanceP) + '"');
  L.push(sideO + ': "' + open(argsO, stanceO) + '"', '');

  const printArgs = (label, args) => {
    args.forEach((a, i) => {
      L.push(label + (i + 1) + '. [' + a.key + '] ' + a.claim);
      L.push('   Reasoning: ' + a.why);
      L.push('   Evidence to bring: ' + a.ev);
      L.push('   Weak point to prepare for: ' + a.weak);
    });
  };
  L.push('[4] CASE FOR: ' + sideP, sub);
  printArgs('P', argsP);
  L.push('');
  L.push('[5] CASE FOR: ' + sideO, sub);
  printArgs('O', argsO);
  L.push('');

  L.push('[6] REBUTTALS', sub);
  for (let i = 0; i < 2; i++) {
    L.push(sideP + ' answers O' + (i + 1) + ': "The other side says ' + lc(noDot(argsO[i].claim)) + '. But note the weak spot: ' + lc(argsO[i].weak) + ' Our point stands: ' + lc(noDot(argsP[i].claim)) + '."');
  }
  for (let i = 0; i < 2; i++) {
    L.push(sideO + ' answers P' + (i + 1) + ': "The other side says ' + lc(noDot(argsP[i].claim)) + '. But note the weak spot: ' + lc(argsP[i].weak) + ' Our point stands: ' + lc(noDot(argsO[i].claim)) + '."');
  }
  L.push('');

  L.push('[7] CROSS-EXAMINATION', sub);
  L.push(sideP + ' asks:');
  qP.slice(0, 2).forEach((q, i) => L.push('  Q' + (i + 1) + '. ' + q));
  L.push(sideO + ' asks:');
  qO.slice(0, 2).forEach((q, i) => L.push('  Q' + (i + 1) + '. ' + q));
  L.push('');

  L.push('[8] FALLACY WATCH', sub);
  const F = fallacies(type, c);
  const printF = (side, list) => {
    L.push(side + ' should avoid:');
    list.forEach((f) => {
      L.push('  - ' + f.name + '. Sounds like: ' + f.ex);
      L.push('    Why it fails: ' + f.why + ' Better: ' + f.better);
    });
  };
  printF(sideP, F.P);
  printF(sideO, F.O);
  L.push('Both sides can also slip into appeal to emotion ("Think of the ' + D.s[0] + '!") and ad hominem ("They only say that because of who they are"). Spot and name them.', '');

  L.push('[9] CLOSING STATEMENTS', sub);
  const closing = (args, stance, tail) => 'Return to the motion: ' + topic.replace(/"/g, "'") + ' We made three points. One: ' + lc(noDot(args[0].claim)) + '. Two: ' + lc(noDot(args[1].claim)) + '. Three: ' + lc(noDot(args[2].claim)) + '. ' + tail + ' We ask you to agree that ' + stance + '.';
  L.push(sideP + ': "' + closing(argsP, stanceP, (type === 'comparison' ? 'The other side made fair points, but ours hold up on the criteria that matter most.' : 'The other side raised real concerns, but each one is a reason to do it carefully, not a reason to avoid the question.')) + '"');
  L.push(sideO + ': "' + closing(argsO, stanceO, (type === 'comparison' ? 'The other side made fair points, but ours hold up on the criteria that matter most.' : 'The other side offered hopes; we offered the risks and the questions they could not answer.')) + '"', '');

  const S = score(topic, type);
  const pad = (s, n) => String(s).padEnd(n);
  L.push('[10] VERDICT', sub);
  L.push(pad('Criterion', 34) + pad('Proposition/A', 15) + 'Opposition/B');
  const rows = [['Clarity of position', 'Clarity'], ['Evidence potential', 'Evidence'], ['Strength of rebuttal', 'Rebuttal'], ['Safety from overreach', 'Overreach']];
  rows.forEach(([label, k]) => L.push(pad(label, 34) + pad(S.P[k], 15) + S.O[k]));
  L.push(pad('TOTAL (out of 20)', 34) + pad(S.tp, 15) + S.to);
  const diff = Math.abs(S.tp - S.to);
  const winner = S.tp > S.to ? sideP : sideO;
  const verdict = diff === 0 ? 'SPLIT DECISION. Neither side has a structural edge in this script.' : (diff >= 3 ? 'CLEAR EDGE: ' : 'NARROW EDGE: ') + winner + '.';
  L.push('', 'VERDICT: ' + verdict);
  L.push('How it was scored (heuristic, based on the wording of the motion and the shape of the arguments):');
  S.why.forEach((w) => L.push('  - ' + w));
  L.push('This verdict rates how well each side\'s argument holds up in this script. It is not a ruling on the truth. A real debate is decided by the evidence presented live.', '');

  L.push('[11] WHAT WOULD SETTLE IT', sub);
  L.push('- ' + cap(D.ev) + '.');
  L.push('- A definition of success that both sides accept before the debate starts.');
  L.push('- ' + (type === 'comparison' ? 'Side-by-side results using identical measures for both options.' : type === 'policy' ? 'Evidence from a pilot or from places that have tried a similar change.' : 'Studies with proper comparison groups, and independent replication.'));
  L.push(bar, 'Generated by DebateArena. Use it to prepare, practise and think. Check real facts before quoting them.', bar);

  return ascii(L.join('\n'));
}
