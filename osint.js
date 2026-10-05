// UserFinder — username footprint checker
// Verified: platforms with public, CORS-enabled APIs, checked live.
// Manual: platforms that block browser lookups, so we link to the profile URL.

const form = document.getElementById("search-form");
const input = document.getElementById("username-input");
const statusEl = document.getElementById("status");
const resultsEl = document.getElementById("results");
const verifiedGrid = document.getElementById("verified-grid");
const manualGrid = document.getElementById("manual-grid");
const variantsToggle = document.getElementById("variants-toggle");
const variantsPanel = document.getElementById("variants-panel");
const chipsEl = document.getElementById("variant-chips");
const customInput = document.getElementById("custom-variant");
const addBtn = document.getElementById("add-variant");
const hintEl = document.getElementById("variant-hint");

const MAX_VARIANTS = 5;
const CONCURRENCY = 4;

const favicon = (domain) =>
  `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

// ---- Verified platforms (live API checks) ----
// Each: name, domain (for icon), profile(u) URL, api(u) URL,
// parse(res, json) -> null if not found, or { avatar, bio, stats }
const VERIFIED = [
  {
    name: "GitHub",
    valid: /^[a-z\\d](?:[a-z\\d]|-(?=[a-z\\d])){0,38}$/i,
    normalize: (u) => u.toLowerCase(),
    domain: "github.com",
    profile: (u) => `https://github.com/${u}`,
    api: (u) => `https://api.github.com/users/${u}`,
    parse: (d) => ({
      avatar: d.avatar_url,
      bio: d.bio,
      stats: `${d.public_repos} repos · ${d.followers} followers`,
    }),
  },
  {
    name: "GitLab",
    valid: /^[\\w.-]{2,255}$/,
    domain: "gitlab.com",
    profile: (u) => `https://gitlab.com/${u}`,
    api: (u) => `https://gitlab.com/api/v4/users?username=${u}`,
    parse: (d) =>
      Array.isArray(d) && d.length
        ? { avatar: d[0].avatar_url, bio: d[0].name, stats: d[0].state }
        : null,
  },
  {
    name: "Codeberg",
    valid: /^[\\w.-]{1,40}$/,
    domain: "codeberg.org",
    profile: (u) => `https://codeberg.org/${u}`,
    api: (u) => `https://codeberg.org/api/v1/users/${u}`,
    parse: (d) => ({
      avatar: d.avatar_url,
      bio: d.description || d.full_name,
      stats: `${d.followers_count ?? 0} followers`,
    }),
  },
  {
    name: "Docker Hub",
    valid: /^[a-z0-9]{4,30}$/,
    normalize: (u) => u.toLowerCase(),
    domain: "hub.docker.com",
    profile: (u) => `https://hub.docker.com/u/${u}`,
    api: (u) => `https://hub.docker.com/v2/users/${u}/`,
    parse: (d) => ({
      avatar: d.gravatar_url,
      bio: d.full_name || d.company,
      stats: d.date_joined ? `Joined ${d.date_joined.slice(0, 10)}` : "",
    }),
  },
  {
    name: "Lichess",
    valid: /^[\\w-]{2,30}$/,
    normalize: (u) => u.toLowerCase(),
    domain: "lichess.org",
    profile: (u) => `https://lichess.org/@/${u}`,
    api: (u) => `https://lichess.org/api/user/${u}`,
    parse: (d) =>
      d.closed
        ? null
        : {
            bio: d.profile?.bio,
            stats: d.count ? `${d.count.all} games` : "",
          },
  },
  {
    name: "Chess.com",
    valid: /^[\\w-]{3,25}$/,
    normalize: (u) => u.toLowerCase(),
    domain: "chess.com",
    profile: (u) => `https://www.chess.com/member/${u}`,
    api: (u) => `https://api.chess.com/pub/player/${u.toLowerCase()}`,
    parse: (d) => ({
      avatar: d.avatar,
      bio: d.name,
      stats: `${d.followers ?? 0} followers`,
    }),
  },
  {
    name: "Keybase",
    valid: /^[a-z0-9_]{2,16}$/,
    normalize: (u) => u.toLowerCase(),
    domain: "keybase.io",
    profile: (u) => `https://keybase.io/${u}`,
    api: (u) =>
      `https://keybase.io/_/api/1.0/user/lookup.json?usernames=${u}&fields=basics,profile,pictures`,
    parse: (d) => {
      const them = d.them && d.them[0];
      if (!them) return null;
      return {
        avatar: them.pictures?.primary?.url,
        bio: them.profile?.bio || them.profile?.full_name,
      };
    },
  },
  {
    name: "Hacker News",
    valid: /^\\w{2,15}$/,
    domain: "news.ycombinator.com",
    profile: (u) => `https://news.ycombinator.com/user?id=${u}`,
    api: (u) => `https://hacker-news.firebaseio.com/v0/user/${u}.json`,
    parse: (d) =>
      d ? { bio: stripHtml(d.about), stats: `${d.karma} karma` } : null,
  },
  {
    name: "DEV",
    valid: /^[\\w-]{1,30}$/,
    normalize: (u) => u.toLowerCase(),
    domain: "dev.to",
    profile: (u) => `https://dev.to/${u}`,
    api: (u) => `https://dev.to/api/users/by_username?url=${u}`,
    parse: (d) => ({
      avatar: d.profile_image,
      bio: d.summary || d.name,
      stats: d.joined_at ? `Joined ${d.joined_at}` : "",
    }),
  },
];

// ---- Manual-check platforms (links only) ----
const MANUAL = [
  ["X / Twitter", "x.com", (u) => `https://x.com/${u}`],
  ["Instagram", "instagram.com", (u) => `https://www.instagram.com/${u}/`],
  ["TikTok", "tiktok.com", (u) => `https://www.tiktok.com/@${u}`],
  ["Reddit", "reddit.com", (u) => `https://www.reddit.com/user/${u}`],
  ["YouTube", "youtube.com", (u) => `https://www.youtube.com/@${u}`],
  ["Twitch", "twitch.tv", (u) => `https://www.twitch.tv/${u}`],
  ["Pinterest", "pinterest.com", (u) => `https://www.pinterest.com/${u}/`],
  ["Medium", "medium.com", (u) => `https://medium.com/@${u}`],
  ["Steam", "steamcommunity.com", (u) => `https://steamcommunity.com/id/${u}`],
  ["SoundCloud", "soundcloud.com", (u) => `https://soundcloud.com/${u}`],
  ["Spotify", "open.spotify.com", (u) => `https://open.spotify.com/user/${u}`],
  ["Telegram", "t.me", (u) => `https://t.me/${u}`],
  ["Mastodon.social", "mastodon.social", (u) => `https://mastodon.social/@${u}`],
  ["Bluesky", "bsky.app", (u) => `https://bsky.app/profile/${u}.bsky.social`],
  ["LinkedIn", "linkedin.com", (u) => `https://www.linkedin.com/in/${u}`],
  ["Behance", "behance.net", (u) => `https://www.behance.net/${u}`],
].map(([name, domain, profile]) => ({ name, domain, profile }));

// ---- Helpers ----
function stripHtml(html) {
  if (!html) return "";
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent || "";
}

function truncate(text, n = 110) {
  if (!text) return "";
  return text.length > n ? text.slice(0, n - 1) + "…" : text;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createCard(platform, username, badgeText, badgeClass) {
  const card = el("div", "card");

  const head = el("div", "card-head");
  const icon = el("img", "card-icon");
  icon.src = favicon(platform.domain);
  icon.alt = "";
  icon.loading = "lazy";
  head.append(icon, el("span", "card-name", platform.name));
  const badge = el("span", `card-badge ${badgeClass}`, badgeText);
  head.append(badge);
  card.append(head);

  const link = el("a", "card-link", "Open profile ↗");
  link.href = platform.profile(encodeURIComponent(username));
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  card.append(link);

  return { card, badge, link };
}

function setBadge(badge, text, cls) {
  badge.textContent = text;
  badge.className = `card-badge ${cls}`;
}

function fillDetails(card, link, info) {
  if (!info) return;
  if (info.avatar || info.bio) {
    const body = el("div", "card-body");
    if (info.avatar) {
      const img = el("img", "card-avatar");
      img.src = info.avatar;
      img.alt = "";
      img.loading = "lazy";
      img.referrerPolicy = "no-referrer";
      img.onerror = () => img.remove();
      body.append(img);
    }
    if (info.bio) body.append(el("div", "card-bio", truncate(info.bio)));
    card.insertBefore(body, link);
  }
  if (info.stats) card.insertBefore(el("div", "card-stats", info.stats), link);
}

// ---- Variant generation ----
// Tier 1: separator changes (only if the input has a separator — we never guess word splits).
// Tier 2: common suffix/prefix patterns. Tier 3 (leetspeak, years) is intentionally left out.
function generateVariants(username) {
  const out = [];
  const seen = new Set([username.toLowerCase()]);
  const add = (value, tier) => {
    const key = value.toLowerCase();
    if (!value || seen.has(key) || value.length > 30) return;
    seen.add(key);
    out.push({ value, tier });
  };

  const parts = username.split(/[_.\-]+/).filter(Boolean);
  if (parts.length > 1) {
    ["", "_", ".", "-"].forEach((sep) => add(parts.join(sep), 1));
  }

  const compact = parts.join("") || username;
  [`${compact}1`, `${compact}01`, `${compact}_`, `the${compact}`, `real${compact}`].forEach(
    (v) => add(v, 2)
  );

  return out.slice(0, MAX_VARIANTS);
}

// ---- Variant preview UI ----
// Chips = user's custom variations first, then generated suggestions.
// Total ticked chips can never exceed MAX_VARIANTS.
const unticked = new Set(); // values the user turned off
let custom = [];            // values the user added or edited

const sameName = (a, b) => a.toLowerCase() === b.toLowerCase();

function setHint(text, isError = false) {
  hintEl.textContent = text;
  hintEl.classList.toggle("error", isError);
}

function renderVariantPreview() {
  chipsEl.replaceChildren();
  if (!variantsToggle.checked) {
    variantsPanel.classList.add("hidden");
    return;
  }
  variantsPanel.classList.remove("hidden");

  const username = input.value.trim();
  const suggestions = username
    ? generateVariants(username).filter((v) => !custom.some((c) => sameName(c, v.value)))
    : [];
  const list = [
    ...custom
      .filter((v) => !username || !sameName(v, username))
      .map((value) => ({ value, tag: "custom", isCustom: true })),
    ...suggestions.map((v) => ({ value: v.value, tag: `T${v.tier}`, isCustom: false })),
  ];

  const active = list.filter((v) => !unticked.has(v.value)).length;
  const atLimit = active >= MAX_VARIANTS;

  if (!list.length) {
    chipsEl.append(el("span", "chip-empty", "Type a username to see suggestions, or add your own below."));
  }

  list.forEach((v) => {
    const checked = !unticked.has(v.value);
    const label = el("label", "chip" + (!checked && atLimit ? " disabled" : ""));

    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = v.value;
    box.checked = checked;
    box.disabled = !checked && atLimit;
    box.addEventListener("change", () => {
      box.checked ? unticked.delete(v.value) : unticked.add(v.value);
      renderVariantPreview();
    });
    label.append(box, document.createTextNode(v.value), el("small", "", v.tag));

    const edit = el("button", "chip-btn", "✎");
    edit.type = "button";
    edit.title = "Edit this variation";
    edit.addEventListener("click", (e) => {
      e.preventDefault();
      if (v.isCustom) {
        custom = custom.filter((c) => c !== v.value);
        unticked.delete(v.value);
      } else {
        unticked.add(v.value); // free its slot; the edited version re-enters as custom
      }
      customInput.value = v.value;
      customInput.focus();
      setHint("Edit the name, then press Add.");
      renderVariantPreview();
      setHint("Edit the name, then press Add.");
    });
    label.append(edit);

    if (v.isCustom) {
      const remove = el("button", "chip-btn", "×");
      remove.type = "button";
      remove.title = "Remove";
      remove.addEventListener("click", (e) => {
        e.preventDefault();
        custom = custom.filter((c) => c !== v.value);
        unticked.delete(v.value);
        renderVariantPreview();
      });
      label.append(remove);
    }
    chipsEl.append(label);
  });

  addBtn.disabled = atLimit;
  customInput.disabled = false;
  setHint(
    atLimit
      ? `${active} of ${MAX_VARIANTS} selected — untick one to add another.`
      : `${active} of ${MAX_VARIANTS} selected.`
  );
}

function addCustomVariant() {
  const value = customInput.value.trim();
  const username = input.value.trim();
  if (!value) return;

  if (/[\s/\\?#]/.test(value)) return setHint("No spaces or characters like / ? #.", true);
  if (value.length > 30) return setHint("Keep it under 30 characters.", true);
  if (username && sameName(value, username)) return setHint("That's the exact username already being checked.", true);
  if (custom.some((c) => sameName(c, value))) return setHint("You've already added that one.", true);

  const activeNow = chipsEl.querySelectorAll("input:checked").length;
  if (activeNow >= MAX_VARIANTS) return setHint(`Limit of ${MAX_VARIANTS} reached — untick one first.`, true);

  custom.push(value);
  unticked.delete(value);
  customInput.value = "";
  renderVariantPreview();
}

addBtn.addEventListener("click", addCustomVariant);
customInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    addCustomVariant();
  }
});

variantsToggle.addEventListener("change", renderVariantPreview);
let previewTimer;
input.addEventListener("input", () => {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(renderVariantPreview, 200);
});

function selectedVariants() {
  if (!variantsToggle.checked) return [];
  return [...chipsEl.querySelectorAll("input:checked")].map((b) => b.value).slice(0, MAX_VARIANTS);
}

// ---- Live check ----
// Returns { state: "found" | "missing" | "unknown", info?, reason? }
async function lookup(platform, name) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(platform.api(encodeURIComponent(name)), {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (res.status === 404) return { state: "missing" };
    if (res.status === 403 || res.status === 429) {
      return { state: "unknown", reason: "Rate limited", blocked: true };
    }
    if (!res.ok) return { state: "unknown", reason: "Error" };

    const info = platform.parse(await res.json());
    return info ? { state: "found", info } : { state: "missing" };
  } catch (err) {
    return {
      state: "unknown",
      reason: err.name === "AbortError" ? "Timed out" : "Unavailable",
    };
  } finally {
    clearTimeout(timer);
  }
}

// Simple concurrency-limited runner
async function runQueue(tasks, limit, worker) {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) await worker(tasks[next++]);
  });
  await Promise.all(runners);
}

// ---- Per-platform card state ----
function refreshBadge(p) {
  const { exact, variants, reason, ui } = p;
  if (exact === undefined) return setBadge(ui.badge, "Checking…", "pending");
  if (exact === "found") return setBadge(ui.badge, "Found", "found");
  if (exact === "invalid") {
    return variants.length
      ? setBadge(ui.badge, "Variant only", "variant")
      : setBadge(ui.badge, "Invalid name", "pending");
  }
  if (exact === "missing") {
    return variants.length
      ? setBadge(ui.badge, "Variant only", "variant")
      : setBadge(ui.badge, "Not found", "not-found");
  }
  setBadge(ui.badge, reason || "Unavailable", "pending");
}

function addVariantLink(p, platform, name) {
  let box = p.ui.card.querySelector(".card-variants");
  if (!box) {
    box = el("div", "card-variants");
    box.append(document.createTextNode("Possible matches: "));
    p.ui.card.append(box);
  }
  const a = el("a", "", name);
  a.href = platform.profile(encodeURIComponent(name));
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  box.append(a);
}

// ---- Main ----
let currentSearch = 0;

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = input.value.trim();
  if (!username) return;

  if (/[\s/\\?#]/.test(username)) {
    statusEl.textContent = "Usernames can't contain spaces or characters like / ? #.";
    return;
  }

  const searchId = ++currentSearch;
  const variantNames = selectedVariants();
  verifiedGrid.replaceChildren();
  manualGrid.replaceChildren();
  resultsEl.classList.remove("hidden");

  MANUAL.forEach((p) => {
    manualGrid.append(createCard(p, username, "Manual", "pending").card);
  });

  // Build state + task list. Exact checks come first so results appear early.
  const state = new Map();
  VERIFIED.forEach((platform) => {
    const ui = createCard(platform, username, "Checking…", "pending");
    verifiedGrid.append(ui.card);
    state.set(platform, { ui, variants: [], exact: undefined, blocked: false });
  });

  const candidates = [{ value: username, exact: true }, ...variantNames.map((v) => ({ value: v, exact: false }))];
  const tasks = [];
  const queued = new Map(VERIFIED.map((p) => [p, new Set()]));

  candidates.forEach((c) => {
    VERIFIED.forEach((platform) => {
      const norm = platform.normalize ? platform.normalize(c.value) : c.value;
      const st = state.get(platform);
      if (!platform.valid.test(norm)) {
        if (c.exact) {
          st.exact = "invalid";
          refreshBadge(st);
        }
        return;
      }
      const key = norm.toLowerCase();
      if (queued.get(platform).has(key)) return; // collapsed duplicate
      queued.get(platform).add(key);
      tasks.push({ platform, name: norm, exact: c.exact });
    });
  });

  let done = 0;
  const total = tasks.length;
  const updateStatus = () => {
    statusEl.textContent = `Checked ${done} of ${total}…`;
  };
  updateStatus();

  await runQueue(tasks, CONCURRENCY, async (task) => {
    const st = state.get(task.platform);
    let result;
    if (st.blocked) {
      result = { state: "unknown", reason: "Rate limited" };
    } else {
      result = await lookup(task.platform, task.name);
      if (result.blocked) st.blocked = true;
    }
    if (searchId !== currentSearch) return;

    if (task.exact) {
      st.exact = result.state;
      st.reason = result.reason;
      if (result.state === "found") fillDetails(st.ui.card, st.ui.link, result.info);
    } else if (result.state === "found") {
      st.variants.push(task.name);
      addVariantLink(st, task.platform, task.name);
    }
    refreshBadge(st);
    done++;
    updateStatus();
  });

  if (searchId !== currentSearch) return;

  const states = [...state.values()];
  const exactFound = states.filter((s) => s.exact === "found").length;
  const variantFound = states.filter((s) => s.exact !== "found" && s.variants.length).length;
  const unknown = states.filter((s) => s.exact === "unknown").length;
  statusEl.textContent =
    `Exact match on ${exactFound} of ${VERIFIED.length} platforms` +
    (variantNames.length ? `; variants on ${variantFound} more` : "") +
    (unknown ? ` (${unknown} couldn't be checked)` : "") +
    `. A match only means the username exists — not that it's the same person.`;
});