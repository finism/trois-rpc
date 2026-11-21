// ==UserScript==
// @name         TROIS.ID -> Discord RPC bridge
// @namespace    trois-rpc
// @version      1.0.0
// @description  Capture le morceau en cours d'écoute sur trois.id et l'envoie à un bridge local pour piloter la Rich Presence Discord
// @match        https://trois.id/*
// @run-at       document-start
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// ==/UserScript==

(function () {
  "use strict";

  const BRIDGE_URL = "http://127.0.0.1:9877";

  // État courant identifié pour le morceau en cours
  let current = {
    track: null,
    alias: null,
    album: null,
  };

  let lastSentAt = 0;
  const MIN_INTERVAL_MS = 4000; // on n'envoie pas plus souvent que ça sauf évènement important

  function post(path, body) {
    try {
      GM_xmlhttpRequest({
        method: "POST",
        url: BRIDGE_URL + path,
        data: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
        // Le bridge local peut ne pas tourner : on ignore silencieusement l'échec
        onerror: () => {},
        ontimeout: () => {},
      });
    } catch (e) {
      // Bridge probablement non lancé, on ignore
    }
  }

  function sendUpdate(force) {
    const audio = getAudioEl();
    if (!audio || !current.track) return;

    const now = Date.now();
    if (!force && now - lastSentAt < MIN_INTERVAL_MS) return;
    lastSentAt = now;

    post("/update", {
      track: current.track,
      alias: current.alias,
      album: current.album,
      currentTime: audio.currentTime,
      duration: Number.isFinite(audio.duration) ? audio.duration : null,
      paused: audio.paused,
    });
  }

  function sendStop() {
    post("/stop", {});
  }

  // ---------------------------------------------------------------------
  // 1) Interception des appels fetch() du site vers /api/live/heartbeat
  //    pour connaître titre / artiste / album en cours.
  //    @run-at document-start garantit qu'on patche avant le chargement
  //    du bundle JS du site.
  // ---------------------------------------------------------------------
  const win = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  const originalFetch = win.fetch;

  win.fetch = function (input, init) {
    try {
      const url = typeof input === "string" ? input : input?.url;
      const method = (init?.method || (typeof input === "object" && input?.method) || "GET").toUpperCase();

      if (url && url.includes("/api/live/heartbeat") && method === "POST") {
        let bodyText = init?.body;
        if (bodyText && typeof bodyText === "string") {
          try {
            const payload = JSON.parse(bodyText);
            if (payload && payload.track) {
              current = {
                track: payload.track,
                alias: payload.alias ?? null,
                album: payload.album ?? null,
              };
              sendUpdate(true);
            }
          } catch (e) {
            // JSON non parsable, on ignore
          }
        }
      }
    } catch (e) {
      // On ne doit jamais casser le fetch du site à cause de ce script
    }

    return originalFetch.apply(this, arguments);
  };

  // ---------------------------------------------------------------------
  // 2) Repérage de l'élément <audio> du lecteur (inséré dynamiquement par
  //    l'app React), et écoute de ses évènements natifs.
  // ---------------------------------------------------------------------
  let boundAudio = null;

  function getAudioEl() {
    return document.querySelector("audio");
  }

  function bindAudio(audio) {
    if (!audio || audio === boundAudio) return;
    boundAudio = audio;

    audio.addEventListener("play", () => sendUpdate(true));
    audio.addEventListener("pause", () => sendUpdate(true));
    audio.addEventListener("ended", () => sendStop());
    audio.addEventListener("loadedmetadata", () => sendUpdate(true));
    audio.addEventListener("timeupdate", () => sendUpdate(false));
  }

  const observer = new MutationObserver(() => {
    const audio = getAudioEl();
    if (audio && audio !== boundAudio) {
      bindAudio(audio);
    }
  });

  function startObserving() {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const existing = getAudioEl();
    if (existing) bindAudio(existing);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startObserving);
  } else {
    startObserving();
  }

  // ---------------------------------------------------------------------
  // 3) Signal d'arrêt quand on quitte/ferme la page ou change d'onglet
  //    pour de bon, afin que la Rich Presence disparaisse plus vite que
  //    le délai d'inactivité par défaut du bridge.
  // ---------------------------------------------------------------------
  window.addEventListener("pagehide", sendStop);
  window.addEventListener("beforeunload", sendStop);
})();
