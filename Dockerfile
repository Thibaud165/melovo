# Melovo — image ARM64/AMD64 pour Raspberry Pi (et autres)
FROM node:22-bookworm-slim

# ffmpeg (conversion MP4 -> MP3, ffprobe pour les tags) via apt.
# yt-dlp : binaire standalone (aucune dépendance Python), choisi selon l'architecture.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates curl \
  && ARCH="$(dpkg --print-architecture)" \
  && case "$ARCH" in \
       arm64) YTDLP=yt-dlp_linux_aarch64 ;; \
       amd64) YTDLP=yt-dlp_linux ;; \
       *) echo "Architecture non supportée: $ARCH" && exit 1 ;; \
     esac \
  && curl -fL "https://github.com/yt-dlp/yt-dlp/releases/latest/download/${YTDLP}" -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && apt-get purge -y curl \
  && apt-get autoremove -y \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Dépendances d'abord (cache Docker) — better-sqlite3 / argon2 / sharp fournissent
# des binaires précompilés linux-arm64, aucun toolchain de build nécessaire.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

# Vérification au build : ffmpeg et yt-dlp doivent être exécutables.
RUN ffmpeg -version >/dev/null && yt-dlp --version >/dev/null

ENV NODE_ENV=production
EXPOSE 8080

CMD ["node", "server/index.js"]
