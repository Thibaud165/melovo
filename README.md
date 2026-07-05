# Melovo

Mini Spotify auto-hébergé : importe, gère et écoute ta musique en local
(Node.js · SQLite · Docker · Raspberry Pi).

Melovo est une application web multi-utilisateurs pensée pour tourner sur un
Raspberry Pi, accessible en réseau local et via Tailscale, **entièrement
hors-ligne** (aucun CDN : polices, icônes et scripts sont self-hostés).

- Import de musique par **fichier MP3/MP4** (conversion automatique en MP3) ou
  par **lien YouTube / YouTube Music** (`yt-dlp`), avec titre, artiste et
  pochette pré-remplis.
- **Bibliothèque personnelle** par compte, playlists personnalisables
  (pochette, couleur), **partage** en lecture seule ou en édition.
- **Lecteur** fixe façon Spotify : shuffle, repeat (un titre / la liste),
  précédent/suivant, seek (HTTP Range), la lecture survit à la navigation.
- **Panneau admin** : création de comptes, réinitialisation de mot de passe
  par code provisoire, suppression.
- Direction artistique « station d'écoute hi-fi analogique » — voir
  [DESIGN.md](DESIGN.md).

## Prérequis

- Un hôte ARM64 ou AMD64 avec **Docker + Docker Compose** (testé sur
  Raspberry Pi 5, Ubuntu Server, Docker 29).
- Un accès à Internet **au moment du build** (téléchargement de l'image, des
  dépendances npm et de yt-dlp). Au quotidien, seule la fonction « import
  YouTube » a besoin d'Internet.

## Installation

```bash
git clone https://github.com/<votre-compte>/melovo.git
cd melovo

# Configuration
cp .env.example .env
nano .env
```

Contenu du `.env` :

| Variable | Rôle |
|---|---|
| `PORT` | Port d'écoute (défaut `8080`) |
| `SESSION_SECRET` | Secret des sessions — générez-le : `openssl rand -hex 32` |
| `ADMIN_USERNAME` | Identifiant du compte admin seedé au premier démarrage |
| `ADMIN_PASSWORD` | Mot de passe **provisoire** de l'admin |

> Le fichier `.env` n'est jamais commité (voir `.gitignore`).

## Lancement

```bash
docker compose up -d --build
docker compose logs -f   # vérifier le démarrage
```

L'app écoute sur `0.0.0.0:${PORT}` : elle est joignable depuis le LAN et
depuis votre tailnet, sans exposition publique.

## Accès

- **Réseau local** : `http://192.168.1.50:8080`
- **Tailscale** : `http://100.95.29.38:8080`
- Version générique : `http://<IP-de-votre-Pi>:<PORT>` — l'IP Tailscale
  s'obtient avec `tailscale ip -4`.

Aucune exposition publique (pas de reverse-proxy ni de tunnel) : l'accès
distant passe exclusivement par Tailscale.

## Première connexion (admin)

1. Ouvrez l'app et connectez-vous avec `ADMIN_USERNAME` / `ADMIN_PASSWORD`.
2. L'app **impose immédiatement** le choix d'un nouveau mot de passe
   personnel (c'est le cas pour tout nouveau compte).
3. Depuis l'avatar en haut à droite → **Administration** :
   - **Créer un compte** : identifiant + mot de passe provisoire à
     transmettre ; la personne le remplacera à sa première connexion.
   - **Réinitialiser** : génère un code provisoire (affiché une seule fois)
     qui sert de mot de passe temporaire.
   - **Supprimer** un compte (ses fichiers et playlists sont effacés).

## Importer de la musique

Page **Importer** (sidebar) :

- **Fichier** : glissez un MP3 ou un MP4 (les MP4 sont convertis en MP3 par
  ffmpeg). Titre, artiste et pochette sont pré-remplis depuis les tags du
  fichier ; ajustez puis **Valider** → le titre rejoint votre bibliothèque.
- **YouTube** : collez un lien YouTube ou YouTube Music. L'audio est extrait
  en MP3 avec pochette et métadonnées (`yt-dlp`), avec une barre de
  progression. Les erreurs (lien invalide, vidéo indisponible…) sont
  affichées clairement.

Les pochettes sont recadrées en carré 500×500. Chaque titre affiche
« Ajouté par [pseudo] », comme sur Spotify.

## Mettre à jour yt-dlp

YouTube change régulièrement ; si les imports échouent, reconstruisez l'image
(le Dockerfile télécharge la **dernière** version de yt-dlp) :

```bash
docker compose build --no-cache melovo
docker compose up -d
```

## Sauvegarde

Tout l'état vit dans `./data/` :

```
data/
├─ audio/             # fichiers MP3
├─ covers/            # pochettes des titres
├─ playlist-covers/   # pochettes des playlists
└─ melovo.db          # base SQLite (comptes, playlists, sessions)
```

Sauvegarder = copier ce dossier (idéalement conteneur arrêté, ou au moins
copier `melovo.db` avec `sqlite3 data/melovo.db ".backup backup.db"`).
Restaurer = remettre le dossier en place avant `docker compose up -d`.

## Structure du projet

```
melovo/
├─ server/            # Express + API REST (auth, import, playlists, streaming)
├─ public/            # SPA vanilla JS (modules ES), CSS, polices, icônes
├─ data/              # volume persistant (gitignoré)
├─ Dockerfile         # node:22-bookworm-slim + ffmpeg + yt-dlp (ARM64/AMD64)
├─ docker-compose.yml
├─ .env.example
├─ DESIGN.md          # direction artistique & specs UI
└─ README.md
```

## Notes techniques

- **SQLite via better-sqlite3**, fichier unique : léger sur le Pi, pas de
  conteneur de base de données, sauvegarde triviale.
- **Sessions persistantes** stockées en SQLite, mots de passe hashés en
  **Argon2id**, login **rate-limité** (anti brute-force).
- **Streaming audio avec HTTP Range** : le seek du lecteur est instantané.
- Frontend **sans bundler** : modules ES servis tels quels par Express.
