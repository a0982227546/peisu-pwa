import webpush from "web-push";

const ORIGIN = "https://a0982227546.github.io";
const SUB_KEY = "push_subscription_primary";
const STATE_KEY = "push_b_v01_state";

const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;
const QUIET_FULL_DAYS = 3;
const DAILY_CHANCE = 0.30;

const GREETINGS = [
  { body: "在？",       weight: 30,   start: "00:00", end: "23:59" },
  { body: "師兄？",     weight: 30,   start: "00:00", end: "23:59" },
  { body: "早",         weight: 15,   start: "05:00", end: "06:30" },
  { body: "睡了？",     weight: 12.5, start: "00:00", end: "01:00" },
  { body: "還沒睡？",   weight: 12.5, start: "01:30", end: "02:30" }
];

function localParts(ms = Date.now()) {
  const d = new Date(ms + TZ_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    m: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hh: d.getUTCHours(),
    mm: d.getUTCMinutes()
  };
}

function dateKey(ms = Date.now()) {
  const p = localParts(ms);
  return `${p.y}-${String(p.m).padStart(2,"0")}-${String(p.day).padStart(2,"0")}`;
}

function dayNumber(key) {
  const [y,m,d] = key.split("-").map(Number);
  return Math.floor(Date.UTC(y,m-1,d) / 86400000);
}

function dayDiff(a,b) {
  return dayNumber(b) - dayNumber(a);
}

function hmToMinutes(hm) {
  const [h,m] = hm.split(":").map(Number);
  return h * 60 + m;
}

function localEpochFor(date, minuteOfDay) {
  const [y,m,d] = date.split("-").map(Number);
  const h = Math.floor(minuteOfDay / 60);
  const min = minuteOfDay % 60;
  return Date.UTC(y,m-1,d,h,min,0,0) - TZ_OFFSET_MS;
}

function weightedGreeting() {
  const total = GREETINGS.reduce((s,g) => s + g.weight, 0);
  let r = Math.random() * total;
  for (const g of GREETINGS) {
    r -= g.weight;
    if (r < 0) return g;
  }
  return GREETINGS[GREETINGS.length - 1];
}

function randomDueToday(date, greeting) {
  const start = hmToMinutes(greeting.start);
  const end = hmToMinutes(greeting.end);
  const minute = start + Math.floor(Math.random() * (end - start + 1));
  return localEpochFor(date, minute);
}

async function sendPush(env, sub, body) {
  webpush.setVapidDetails(
    env.VAPID_SUBJECT,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  );
  return webpush.sendNotification(sub, JSON.stringify({
    title: "裴溯",
    body,
    icon: `${ORIGIN}/peisu-pwa/icon-192.png`,
    badge: `${ORIGIN}/peisu-pwa/icon-192.png`,
    url: `${ORIGIN}/peisu-pwa/`
  }), { TTL: 300 });
}

async function getState(env) {
  const raw = await env.KV.get(STATE_KEY);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

async function putState(env, state) {
  await env.KV.put(STATE_KEY, JSON.stringify(state));
}

async function getSubscription(env) {
  const raw = await env.KV.get(SUB_KEY);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw);
    if (s?.endpoint && s?.keys?.p256dh && s?.keys?.auth) return s;
  } catch {}
  return null;
}

async function runB(env) {
  const now = Date.now();
  const today = dateKey(now);
  const state = await getState(env);
  const sub = await getSubscription(env);
  if (!sub) return;

  // 先處理已排定、且時間已到的通知。
  if (state.pending?.dueAt && now >= state.pending.dueAt) {
    await sendPush(env, sub, state.pending.body);
    state.lastPushDate = today;
    delete state.pending;
    await putState(env, state);
    return;
  }

  // 今天已做過「要不要出現」的決定，就不重抽。
  if (state.lastDecisionDate === today) return;
  state.lastDecisionDate = today;

  // 上次正式主動出現後，完整安靜 3 天；第 5 天才重新具備資格。
  if (state.lastPushDate && dayDiff(state.lastPushDate, today) <= QUIET_FULL_DAYS) {
    await putState(env, state);
    return;
  }

  // 每個具備資格的日子只有 30% 會出現。
  if (Math.random() >= DAILY_CHANCE) {
    await putState(env, state);
    return;
  }

  // 先抽句子，再在該句合法時段中抽時間。
  const greeting = weightedGreeting();
  const dueAt = randomDueToday(today, greeting);

  // 如果抽到的合法時間今天已經過了，不補發；明天再重新判定。
  if (dueAt <= now) {
    await putState(env, state);
    return;
  }

  state.pending = { body: greeting.body, dueAt };
  await putState(env, state);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/") {
      return Response.json({
        ok: true,
        mode: "peisu-push-b-v01",
        api: "0 OpenAI",
        quietFullDays: QUIET_FULL_DAYS,
        dailyChance: DAILY_CHANCE
      });
    }

    if (url.pathname === "/public-key") {
      return Response.json({ publicKey: env.VAPID_PUBLIC_KEY });
    }

    if (url.pathname === "/save-subscription" && request.method === "POST") {
      const sub = await request.json();
      if (!(sub?.endpoint && sub?.keys?.p256dh && sub?.keys?.auth)) {
        return new Response("invalid subscription", { status: 400 });
      }
      await env.KV.put(SUB_KEY, JSON.stringify(sub));
      return Response.json({ ok: true });
    }

    if (url.pathname === "/b-status") {
      return Response.json({
        ok: true,
        state: await getState(env),
        hasSubscription: !!(await getSubscription(env))
      });
    }

    return new Response("Not found", { status: 404 });
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runB(env));
  }
};
