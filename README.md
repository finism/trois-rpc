# TROIS.ID → Discord Rich Presence

Affiche automatiquement sur ton profil Discord le morceau que tu écoutes sur [trois.id](https://trois.id).

## Comment ça marche

1. Un **userscript Tampermonkey** tourne dans ton navigateur sur trois.id. Il :
   - intercepte les appels que le site fait vers `/api/live/heartbeat` (titre, artiste, album du morceau en cours),
   - écoute directement l'élément `<audio>` de la page pour connaître la position de lecture, la durée et l'état (lecture/pause).
2. Il envoie ces infos à une **petite app Node.js** qui tourne en local sur ta machine (`http://127.0.0.1:9877`).
3. Cette app parle à ton client **Discord Desktop** via IPC local et met à jour ta Rich Presence en conséquence.
4. La présence affiche deux boutons : **Listen on TROIS.ID** (la page du morceau) et **Search on YouTube**.
5. Si tu arrêtes d'écouter (onglet fermé, morceau terminé, plus de mise à jour depuis 20s), la Rich Presence disparaît automatiquement.

Aucune donnée ne sort de ta machine : tout se passe en local entre ton navigateur, l'app Node.js et Discord Desktop.

## Prérequis

- [Node.js](https://nodejs.org/) 18+ installé
- Le client **Discord Desktop** installé et connecté (le Rich Presence via IPC ne fonctionne pas sur Discord Web/mobile)
- L'extension navigateur **Tampermonkey** ([Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) / [Firefox](https://addons.mozilla.org/fr/firefox/addon/tampermonkey/))

## Étape 1 — Créer l'application Discord

1. Va sur https://discord.com/developers/applications
2. **New Application** → donne-lui un nom (ex: "TROIS.ID"), ce nom n'apparaît pas forcément dans la présence.
3. Note le **Application ID** (Client ID) affiché sur la page General Information.
4. Dans l'onglet **Rich Presence → Art Assets**, uploade au moins une image (par ex. le logo `spk.png` du site) et nomme-la `spk_logo`. C'est l'image par défaut affichée en grand, en l'absence de pochette par morceau sur le site.
5. Optionnel : uploade aussi deux petites icônes nommées `play` et `pause` pour la petite icône en bas à droite indiquant l'état de lecture.

## Étape 2 — Configurer et lancer le bridge local

```bash
cd server
npm install
cp .env.example .env
```

Édite `.env` et renseigne `DISCORD_CLIENT_ID` avec l'ID récupéré à l'étape 1.

Puis lance :

```bash
npm start
```

Tu devrais voir :
```
[server] En écoute sur http://127.0.0.1:9877
[discord] Connecté en tant que TonPseudo
```

Laisse ce terminal ouvert tant que tu veux que la Rich Presence fonctionne (tu peux aussi le lancer au démarrage de ta session, voir plus bas).

## Étape 3 — Installer le userscript

Tampermonkey installé, clique ici : **[Installer le userscript](https://github.com/finism/trois-rpc/raw/main/userscript/trois-rpc.user.js)**, puis **Installer** dans la fenêtre de Tampermonkey. Les mises à jour arrivent ensuite automatiquement.

Ensuite, va sur https://trois.id, connecte-toi, lance un morceau.

<details><summary>Installation à la main</summary>

1. Ouvre Tampermonkey → **Créer un script**.
2. Supprime le contenu par défaut, colle le contenu de `userscript/trois-rpc.user.js`.
3. Sauvegarde (Ctrl+S).

</details>

## Étape 4 — Vérifier

- Dans le terminal du bridge, tu devrais voir apparaître des lignes du style :
  ```
  [activity] PRISON DE CHAIR — Femtogo / PRETTY DOLLCORPSE
  ```
- Sur ton profil Discord (ou celui d'un ami qui te regarde), la Rich Presence doit afficher le morceau, l'artiste/album, et une barre de progression.

## Limitations connues

- **Type "Listening to"** : Discord réserve officiellement l'affichage spécial "Écoute" (comme pour Spotify) aux intégrations partenaires. Le code configure `type: 2` (Listening) qui fonctionne pour de nombreuses implémentations tierces, mais Discord peut l'afficher comme "En train de jouer à" selon les cas — c'est une limite de la plateforme, pas du code.
- **Pochette** : trois.id n'expose pas d'URL de pochette par morceau/album dans son catalogue (`/api/catalog`). Le projet utilise donc une image par défaut (le logo du site). Si le site ajoute un jour des covers, il suffira de modifier `LARGE_IMAGE_KEY` dynamiquement dans `server/src/index.js` pour utiliser une URL externe par morceau (Discord accepte les URLs d'images externes directement, en plus des assets uploadés).
- **Après un rechargement de page en plein milieu d'un morceau** : le titre en cours n'est réaffiché qu'au prochain `heartbeat` envoyé par le site (fréquence dépendante du comportement interne du site). En pratique ça se met à jour en quelques secondes/dizaines de secondes.
- Le bridge n'écoute que sur `127.0.0.1` (pas accessible depuis le réseau), et Discord doit tourner sur la **même machine** que le bridge (IPC local, pas de solution "à distance" sans mécanisme supplémentaire type relais).

## Lancer le bridge automatiquement au démarrage (optionnel)

- **Windows** : crée un raccourci vers `npm start` (ou un `.bat` avec `cd /d "chemin\vers\server" && npm start`) et place-le dans le dossier de démarrage (`shell:startup`).
- **macOS** : utilise un fichier `.plist` LaunchAgent, ou un outil comme `pm2` (`pm2 start src/index.js --name trois-rpc && pm2 save`).
- **Linux** : service `systemd --user`, ou `pm2` comme ci-dessus.

## Structure du projet

```
trois-rpc/
├── server/                  # App Node.js locale (bridge vers Discord)
│   ├── src/index.js
│   ├── package.json
│   └── .env.example
├── userscript/
│   └── trois-rpc.user.js    # Script Tampermonkey à installer dans le navigateur
└── README.md
```

## Licence

MIT — voir [LICENSE](LICENSE).
