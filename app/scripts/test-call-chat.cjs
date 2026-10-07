/** A call placed from inside a chat (#143) talks to that chat.
 *
 *  The chat's call button is pressed for real and the route it pushes is read
 *  back. The call screen is then stood up on that route with the phone's voice
 *  and microphone swapped for fakes and the daemon swapped for a fake client:
 *  an utterance is "heard" through the recogniser's own result handler, and
 *  the chat's turn is played back as the events the daemon would broadcast.
 *  What was said aloud, and what was sent, is the record the fakes keep.
 *
 *  Run: node scripts/test-call-chat.cjs  (also folded into test-ustabasi.cjs.)
 */
const path = require('path');
const { R } = require('./render-chat.cjs');
const machine = require('./test-handover-machine.cjs');

const root = path.join(__dirname, '..');
const h = R.React.createElement;
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const L = require(path.join(root, 'src/call-lines.ts'));
const V = require(path.join(root, 'src/voice.ts'));
const { client } = require(path.join(root, 'src/ws.ts'));
const SR = require('@jamsch/expo-speech-recognition');

const EN = L.chatCallLines('en-US');

/** A call screen on `params`, picked up, with a fake voice, ear and daemon. */
async function picked(params, replies = {}) {
  const log = [];
  const sent = [];
  const heard = {};
  const listeners = new Set();
  const real = { ...V };
  const realCall = client.call;
  const realHook = SR.useSpeechRecognitionEvent;
  Object.assign(V, {
    locale: () => 'en-US',
    ensureMic: async () => true,
    pickVoice: async () => null,
    voiceName: () => null,
    ring: async () => {},
    pickup: async () => {},
    speak: (text, _lang, onDone) => { log.push(`speak ${text}`); setTimeout(onDone, 0); },
    startListening: () => { log.push('listen'); },
    stopListening() {}, abortListening() {}, stopSpeaking() {},
  });
  SR.useSpeechRecognitionEvent = (name, fn) => { heard[name] = fn; };
  client.call = async (type, data) => {
    sent.push([type, data]);
    return replies[type] ? replies[type](data) : {};
  };
  client.on = (l) => { listeners.add(l); return () => { listeners.delete(l); }; };
  client.onStatus = () => () => {};

  machine.stand({ params });
  const Call = require(path.join(root, 'app/call.tsx')).default;
  R.render('dark', h(Call));
  R.presses().find((p) => p.text === 'Call').press();

  const until = async (pred, ms = 4000) => {
    for (let t = 0; t < ms && !pred(); t += 20) await new Promise((r) => setTimeout(r, 20));
    await flush();
    return pred();
  };
  const listens = () => log.filter((l) => l === 'listen').length;
  await until(() => listens() === 1);

  return {
    log, sent, listens, until,
    /** Say something into the microphone and wait for the call to act on it. */
    async say(text) {
      const before = sent.length;
      heard.result({ results: [{ transcript: text }] });
      await until(() => sent.length > before);
    },
    /** Say something that sends nothing, and wait for the call to listen again. */
    async mumble(text) {
      const before = listens();
      heard.result({ results: [{ transcript: text }] });
      await until(() => listens() > before);
    },
    /** One event of chat `chat_id`, as the daemon broadcasts it. */
    async emit(event, data = {}, chat_id = 'c1') {
      for (const l of [...listeners]) l({ event, chat_id, seq: null, data, ts: 0 });
      await flush();
    },
    done() {
      Object.assign(V, real);
      client.call = realCall;
      delete client.on;
      delete client.onStatus;
      SR.useSpeechRecognitionEvent = realHook;
    },
  };
}

const checks = [];
const ready = (async () => {
  await machine.ready;
  R.words.real();
  try {
    // 1 · the chat's call button opens /call carrying that chat's id
    machine.stand();
    const Conversation = require(path.join(root, 'app/chat/[id].tsx')).Conversation;
    R.render('dark', h(Conversation, { id: 'c1' }));
    const buttons = R.presses().filter((p) => p.label === 'Call');
    buttons[0]?.press();
    await flush();
    checks.push([`chat call: the chat's Call button opens /call with that chat's id — ${JSON.stringify(R.nav.pushed())}`,
      buttons.length === 1 && eq(R.nav.pushed(), [{ pathname: '/call', params: { chat: 'c1' } }])]);

    // 1, 4 · one utterance goes to that chat; a turn with tools says "looking" once
    {
      const call = await picked({ chat: 'c1' }, { 'call.reply': () => ({ text: 'Webhooks fail because the retry counter never resets.' }) });
      try {
        await call.say('why are the webhooks failing');
        checks.push([`chat call: the utterance is sent with chat.send to that chat, and the concierge is not asked — ${JSON.stringify(call.sent)}`,
          eq(call.sent, [['chat.send', { chat_id: 'c1', text: 'why are the webhooks failing' }]])]);
        await call.emit('chat.updated', { status: 'running' });
        await call.emit('tool.use', { id: 't1', tool: 'Grep' });
        await call.emit('tool.use', { id: 't2', tool: 'Read' });
        await call.emit('tool.result', { id: 't1' });
        await call.emit('tool.use', { id: 't3', tool: 'Bash' }, 'c2');       // another chat's turn: not this call's
        await call.emit('tool.use', { id: 't4', tool: 'Read' });
        await call.emit('message.assistant', { text: 'Webhooks fail because the retry counter never resets. ```ts\nx\n```' });
        await call.emit('chat.updated', { status: 'idle' });
        await call.until(() => call.listens() === 2);
        const spoken = call.log.filter((l) => l.startsWith('speak')).slice(1);
        checks.push([`chat call: a turn that runs tools says one brief "looking" line, then the short reply, then listens — ${JSON.stringify(spoken)}`,
          eq(spoken, [`speak ${EN.looking}`, 'speak Webhooks fail because the retry counter never resets.'])
          && call.log[call.log.length - 1] === 'listen'
          && eq(call.sent.map(([t]) => t), ['chat.send', 'call.reply'])
          && call.sent[1][1].chat_id === 'c1']);
      } finally { call.done(); }
    }

    // 5 · an approval is asked aloud; yes allows it, no denies it
    {
      const call = await picked({ chat: 'c1' }, { 'call.reply': () => ({ text: 'Pushed.' }) });
      try {
        await call.say('push it');
        await call.emit('tool.use', { id: 't1', tool: 'Bash' });
        await call.emit('approval.request', { request_id: 'r1', tool: 'Bash', input: { command: 'git push origin main' },
                                              preview: 'git push origin main', danger: false });
        await call.until(() => call.listens() === 2);
        await call.say('yes go ahead');
        await call.emit('approval.resolved', { request_id: 'r1', decision: 'allow' });
        await call.emit('tool.use', { id: 't2', tool: 'Write' });
        await call.emit('approval.request', { request_id: 'r2', tool: 'Write', input: { file_path: '/r/quire/notes.md' },
                                              preview: 'Write /r/quire/notes.md', danger: false });
        await call.until(() => call.listens() === 3);
        // Neither: asked again. "no" is then a word of the question just said,
        // and still an answer.
        await call.mumble('hmm wait');
        await call.say('no');
        await call.emit('approval.resolved', { request_id: 'r2', decision: 'deny' });
        await call.emit('chat.updated', { status: 'idle' });
        await call.until(() => call.listens() === 5);
        const spoken = call.log.filter((l) => l.startsWith('speak')).slice(1).map((l) => l.slice(6));
        const answers = call.sent.filter(([t]) => t === 'approval.respond').map(([, d]) => d);
        checks.push([`chat call: an approval is said as a question, with no command or path read out — ${JSON.stringify(spoken)}`,
          spoken.includes(EN.approval('Bash')) && spoken.includes(EN.approval('Write'))
          && EN.approval('Bash').endsWith('?') && spoken.includes(EN.yesOrNo)
          && !spoken.some((s) => /git push|notes\.md|\//.test(s))]);
        checks.push([`chat call: a spoken yes approves it and a spoken no denies it — ${JSON.stringify(answers)}`,
          eq(answers, [{ chat_id: 'c1', request_id: 'r1', decision: 'allow' },
                       { chat_id: 'c1', request_id: 'r2', decision: 'deny' }])
          && !call.sent.some(([t, d]) => t === 'chat.send' && /^(yes|no)/.test(d.text))]);
        checks.push(['chat call: still one "looking" line for a turn with two tools and two approvals, and the reply at the end',
          spoken.filter((s) => s === EN.looking).length === 1 && spoken[spoken.length - 1] === 'Pushed.']);
      } finally { call.done(); }
    }

    // 6 · the general call is untouched: no chat id, its questions go to the concierge
    {
      const call = await picked({}, { 'call.ask': () => ({ text: 'Two sessions are working.' }) });
      try {
        await call.say('what is running');
        checks.push([`chat call: the general call still asks the concierge — ${JSON.stringify(call.sent)}`,
          eq(call.sent.map(([t]) => t), ['call.hello', 'call.ask'])]);
      } finally { call.done(); }
    }

    checks.push(['chat call: yes and no are heard in either language, a no inside a yes is a no, and a mumble is neither',
      L.yesNo('Evet') === true && L.yesNo('okay') === true && L.yesNo('hayır') === false && L.yesNo('izin verme') === false
      && L.yesNo("don't do it") === false && L.yesNo('hmm wait') === null]);
  } finally {
    R.words.keys();
    R.store.reset();
    R.params.reset();
    R.nav.reset();
  }
})();

module.exports = { checks, ready };

if (require.main === module) {
  void ready.then(() => {
    let bad = 0;
    for (const [name, ok] of checks) {
      console.log((ok ? '  ok    ' : '  FAIL  ') + name);
      if (!ok) bad++;
    }
    console.log(bad ? `${bad} failed` : `all ${checks.length} checks passed`);
    process.exit(bad ? 1 : 0);
  });
}
