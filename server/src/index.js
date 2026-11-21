require("dotenv").config();

const express = require("express");
const { Client } = require("@xhayper/discord-rpc");

const {
  DISCORD_CLIENT_ID,
  PORT = 9877,
  LARGE_IMAGE_KEY = "spk",
  LARGE_IMAGE_TEXT = "TROIS.ID / Archives SPK",
  IDLE_TIMEOUT_MS = 20000,
} = process.env;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

if (!DISCORD_CLIENT_ID || DISCORD_CLIENT_ID === "REMPLACE_MOI") {
  console.error(
    "[config] DISCORD_CLIENT_ID manquant. Vérifie ton fichier .env."
  );
  process.exit(1);
}

// Affiche la configuration réellement chargée.
// Cela permet de vérifier que .env est bien lu.
console.log("========================================");
console.log("[config] Discord Client ID :", DISCORD_CLIENT_ID);
console.log("[config] Large Image Key   :", LARGE_IMAGE_KEY);
console.log("[config] Large Image Text  :", LARGE_IMAGE_TEXT);
console.log("[config] Port              :", PORT);
console.log("========================================");

// ---------------------------------------------------------------------------
// Client Discord
// ---------------------------------------------------------------------------

const rpc = new Client({
  clientId: DISCORD_CLIENT_ID,
});

let discordReady = false;

rpc.on("ready", () => {
  discordReady = true;

  console.log(
    `[discord] Connecté en tant que ${rpc.user?.username ?? "?"}`
  );
});

rpc.on("disconnected", () => {
  discordReady = false;

  console.log(
    "[discord] Déconnecté. Vérifie que Discord Desktop est bien lancé."
  );
});

rpc.login().catch((err) => {
  console.error(
    "[discord] Impossible de se connecter au client Discord Desktop."
  );

  console.error(
    err?.message ?? err
  );
});

// ---------------------------------------------------------------------------
// État courant
// ---------------------------------------------------------------------------

let lastUpdateAt = 0;
let activityIsSet = false;
let lastSignature = null;

// ---------------------------------------------------------------------------
// Signature permettant d'éviter les mises à jour inutiles
// ---------------------------------------------------------------------------

function buildSignature(payload) {
  const bucket = Math.floor(
    (payload.currentTime ?? 0) / 5
  );

  return `${payload.track}|${payload.alias}|${payload.album}|${payload.paused}|${bucket}`;
}

// ---------------------------------------------------------------------------
// Création / mise à jour de la Rich Presence
// ---------------------------------------------------------------------------

async function applyActivity(payload) {
  const {
    track,
    alias,
    album,
    currentTime,
    duration,
    paused,
  } = payload;

  if (!track || !alias) {
    return;
  }

  const signature = buildSignature(payload);

  if (signature === lastSignature) {
    return;
  }

  lastSignature = signature;

  // -------------------------------------------------------------------------
  // Rich Presence
  // -------------------------------------------------------------------------

  const activity = {
    details: track,

    state: album
      ? `${alias} — ${album}`
      : alias,

    // Asset Discord
    largeImageKey: LARGE_IMAGE_KEY,
    largeImageText: LARGE_IMAGE_TEXT,

    instance: false,

    // Type 2 = Listening
    type: 2,
  };

  // -------------------------------------------------------------------------
  // Progression de la musique
  // -------------------------------------------------------------------------

  if (
    !paused &&
    typeof currentTime === "number" &&
    typeof duration === "number" &&
    duration > 0
  ) {
    const now = Date.now();

    activity.startTimestamp = Math.round(
      now - currentTime * 1000
    );

    activity.endTimestamp = Math.round(
      activity.startTimestamp + duration * 1000
    );
  }

  // -------------------------------------------------------------------------
  // Discord pas encore connecté
  // -------------------------------------------------------------------------

  if (!discordReady) {
    console.log(
      "[discord] Pas encore prêt, mise à jour ignorée."
    );

    return;
  }

  // -------------------------------------------------------------------------
  // Envoi à Discord
  // -------------------------------------------------------------------------

  try {
    console.log(
      `[activity] Envoi de l'asset "${LARGE_IMAGE_KEY}" à Discord...`
    );

    await rpc.user?.setActivity(activity);

    activityIsSet = true;

    console.log(
      `[activity] ${track} — ${alias}` +
      `${album ? " / " + album : ""}` +
      `${paused ? " (pause)" : ""}`
    );

    console.log(
      `[activity] largeImageKey = ${LARGE_IMAGE_KEY}`
    );

  } catch (err) {
    console.error(
      "[discord] Échec setActivity:",
      err?.message ?? err
    );
  }
}

// ---------------------------------------------------------------------------
// Effacement de la Rich Presence
// ---------------------------------------------------------------------------

async function clearActivityIfNeeded() {
  if (!activityIsSet) {
    return;
  }

  try {
    await rpc.user?.clearActivity();

    console.log(
      "[activity] Effacée (plus d'écoute détectée)."
    );

  } catch (err) {
    console.error(
      "[discord] Échec clearActivity:",
      err?.message ?? err
    );

  } finally {
    activityIsSet = false;
    lastSignature = null;
  }
}

// ---------------------------------------------------------------------------
// Watchdog
// ---------------------------------------------------------------------------

setInterval(() => {
  if (
    lastUpdateAt &&
    Date.now() - lastUpdateAt > Number(IDLE_TIMEOUT_MS)
  ) {
    clearActivityIfNeeded();

    lastUpdateAt = 0;
  }
}, 5000);

// ---------------------------------------------------------------------------
// Serveur HTTP local
// ---------------------------------------------------------------------------

const app = express();

app.use(express.json());

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

app.use((req, res, next) => {
  res.header(
    "Access-Control-Allow-Origin",
    "https://trois.id"
  );

  res.header(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );

  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

// ---------------------------------------------------------------------------
// /update
// ---------------------------------------------------------------------------

app.post("/update", async (req, res) => {
  const {
    track,
    alias,
    album,
    currentTime,
    duration,
    paused,
  } = req.body ?? {};

  lastUpdateAt = Date.now();

  try {
    await applyActivity({
      track,
      alias,
      album,
      currentTime,
      duration,
      paused,
    });

    res.json({
      ok: true,
    });

  } catch (err) {
    console.error(
      "[server] Erreur update:",
      err?.message ?? err
    );

    res.status(500).json({
      ok: false,
      error: err?.message ?? String(err),
    });
  }
});

// ---------------------------------------------------------------------------
// /stop
// ---------------------------------------------------------------------------

app.post("/stop", async (_req, res) => {
  lastUpdateAt = 0;

  await clearActivityIfNeeded();

  res.json({
    ok: true,
  });
});

// ---------------------------------------------------------------------------
// /
// ---------------------------------------------------------------------------

app.get("/", (_req, res) => {
  res.send(
    "trois-rpc-bridge is running"
  );
});

// ---------------------------------------------------------------------------
// Démarrage serveur
// ---------------------------------------------------------------------------

app.listen(
  Number(PORT),
  "127.0.0.1",
  () => {
    console.log(
      `[server] En écoute sur http://127.0.0.1:${PORT}`
    );
  }
);

// ---------------------------------------------------------------------------
// Arrêt propre
// ---------------------------------------------------------------------------

async function shutdown() {
  console.log(
    "\n[server] Arrêt en cours..."
  );

  await clearActivityIfNeeded();

  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);