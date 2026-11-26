require("dotenv").config();

const express = require("express");
const { Client } = require("@xhayper/discord-rpc");

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const {
  DISCORD_CLIENT_ID,
  PORT = 9877,
  LARGE_IMAGE_KEY = "spk_logo",
  LARGE_IMAGE_TEXT = "TROIS.ID / Archives SPK",
  IDLE_TIMEOUT_MS = 20000,
} = process.env;

// Un Client ID Discord est un nombre (snowflake) : ça rejette aussi les placeholders de .env.example.
if (!/^\d+$/.test(DISCORD_CLIENT_ID ?? "")) {
  console.error("[config] DISCORD_CLIENT_ID manquant ou invalide. Vérifie ton fichier .env.");
  process.exit(1);
}

console.log("[config] Client ID:", DISCORD_CLIENT_ID, "| image:", LARGE_IMAGE_KEY, "| port:", PORT);

const RECONNECT_DELAY_MS = 15000;
const SEEK_TOLERANCE_MS = 2000; // écart de position au-delà duquel on renvoie les timestamps

// ---------------------------------------------------------------------------
// Client Discord (avec reconnexion automatique)
// ---------------------------------------------------------------------------

const rpc = new Client({ clientId: DISCORD_CLIENT_ID });
let discordReady = false;
let reconnectTimer = null;

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectDiscord();
  }, RECONNECT_DELAY_MS);
}

function connectDiscord() {
  rpc.login().catch((err) => {
    console.error(`[discord] Connexion impossible (${err?.message ?? err}). Nouvel essai dans ${RECONNECT_DELAY_MS / 1000}s.`);
    scheduleReconnect();
  });
}

rpc.on("ready", () => {
  discordReady = true;
  resetActivityState(); // force le renvoi de la présence après une reconnexion
  console.log(`[discord] Connecté en tant que ${rpc.user?.username ?? "?"}`);
});

rpc.on("disconnected", () => {
  discordReady = false;
  console.log("[discord] Déconnecté. Vérifie que Discord Desktop est lancé.");
  scheduleReconnect();
});

connectDiscord();

// ---------------------------------------------------------------------------
// Rich Presence
// ---------------------------------------------------------------------------

let lastUpdateAt = 0;
let activityIsSet = false;
let lastKey = null; // morceau + état pause de la dernière présence envoyée
let lastStart = null; // startTimestamp de la dernière présence envoyée

function resetActivityState() {
  activityIsSet = false;
  lastKey = null;
  lastStart = null;
}

// Discord refuse les textes de moins de 2 ou plus de 128 caractères.
function fitText(value) {
  const s = String(value).trim();
  return s.length > 128 ? s.slice(0, 127) + "…" : s.padEnd(2, "⠀");
}

// Page du morceau sur trois.id (même lien que le bouton « partager » du site).
function troisTrackUrl(track, alias) {
  return `https://trois.id/track/${encodeURIComponent(alias)}/${encodeURIComponent(track)}`;
}

// Lien de recherche YouTube du morceau en cours (Discord limite l'URL d'un bouton à 512 caractères).
function youtubeSearch(track, alias) {
  return "https://www.youtube.com/results?search_query=" + encodeURIComponent(`${alias} ${track}`.slice(0, 200));
}

async function applyActivity({ track, alias, album, currentTime, duration, paused }) {
  if (!track || !alias || !discordReady) return;

  const hasProgress =
    !paused && Number.isFinite(currentTime) && Number.isFinite(duration) && duration > 0;
  const start = hasProgress ? Math.round(Date.now() - currentTime * 1000) : null;
  const key = `${track}|${alias}|${album}|${Boolean(paused)}`;

  // Inutile de renvoyer la même présence : on ne le fait que si le morceau,
  // l'état pause ou la position (seek) a changé.
  const seeked = start !== null && (lastStart === null || Math.abs(start - lastStart) > SEEK_TOLERANCE_MS);
  if (key === lastKey && !seeked) return;

  const activity = {
    type: 2, // Listening
    details: fitText(track),
    state: fitText(album ? `${alias} — ${album}` : alias),
    largeImageKey: LARGE_IMAGE_KEY,
    largeImageText: fitText(LARGE_IMAGE_TEXT),
    smallImageKey: paused ? "pause" : "play",
    smallImageText: paused ? "En pause" : "En lecture",
    instance: false,
    buttons: [
      { label: "Listen on TROIS.ID", url: troisTrackUrl(track, alias) },
      { label: "Search on YouTube", url: youtubeSearch(track, alias) },
    ],
  };
  if (start !== null) {
    activity.startTimestamp = start;
    activity.endTimestamp = Math.round(start + duration * 1000);
  }

  // Mémorisé avant l'await : deux requêtes simultanées (le site envoie ses
  // heartbeats par paires) ne doivent pas envoyer deux fois la même présence.
  const changedTrack = key !== lastKey;
  lastKey = key;
  lastStart = start;
  try {
    await rpc.user?.setActivity(activity);
    activityIsSet = true;
    // Un simple recalage de la barre de progression n'est pas affiché.
    if (changedTrack) {
      console.log(`[activity] ${track} — ${alias}${album ? " / " + album : ""}${paused ? " (pause)" : ""}`);
    }
  } catch (err) {
    lastKey = null; // réessaiera à la prochaine mise à jour
    console.error("[discord] Échec setActivity:", err?.message ?? err);
  }
}

async function clearActivityIfNeeded() {
  if (!activityIsSet) return;
  try {
    if (discordReady) await rpc.user?.clearActivity();
    console.log("[activity] Effacée (plus d'écoute détectée).");
  } catch (err) {
    console.error("[discord] Échec clearActivity:", err?.message ?? err);
  } finally {
    resetActivityState();
  }
}

// Efface la présence si le userscript ne donne plus de nouvelles (onglet fermé, etc.)
setInterval(() => {
  if (lastUpdateAt && Date.now() - lastUpdateAt > Number(IDLE_TIMEOUT_MS)) {
    lastUpdateAt = 0;
    clearActivityIfNeeded();
  }
}, 5000);

// ---------------------------------------------------------------------------
// Serveur HTTP local
// ---------------------------------------------------------------------------

const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "https://trois.id");
  res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: "10kb" }));

app.post("/update", async (req, res) => {
  const { track, alias, album, currentTime, duration, paused } = req.body ?? {};
  lastUpdateAt = Date.now();
  await applyActivity({ track, alias, album, currentTime, duration, paused });
  res.json({ ok: true });
});

app.post("/stop", async (_req, res) => {
  lastUpdateAt = 0;
  await clearActivityIfNeeded();
  res.json({ ok: true });
});

app.get("/", (_req, res) => res.send("trois-rpc-bridge is running"));

app
  .listen(Number(PORT), "127.0.0.1", () => {
    console.log(`[server] En écoute sur http://127.0.0.1:${PORT}`);
  })
  .on("error", (err) => {
    console.error(`[server] Impossible d'écouter sur le port ${PORT}:`, err.message);
    process.exit(1);
  });

// ---------------------------------------------------------------------------
// Arrêt propre
// ---------------------------------------------------------------------------

async function shutdown() {
  console.log("\n[server] Arrêt en cours...");
  await clearActivityIfNeeded();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
