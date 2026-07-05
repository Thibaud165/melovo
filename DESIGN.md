# DESIGN.md — Melovo

> **Concept : « Station d'écoute hi-fi analogique »**
> Melovo reprend l'ossature de Spotify (sidebar, zone principale scrollable, barre de
> lecture fixe en bas, la pochette porte la couleur) mais avec une signature propre :
> une ambiance **hi-fi analogique chaleureuse** — espresso quasi-noir, ambre de lampe
> de studio, compteurs en police mono. Pas de `#121212` froid, pas de glassmorphisme,
> pas de dégradés violets, pas de néon.
>
> Toute l'interface DOIT respecter ce document.

---

## 1. Palette (sombre, chaude) — base FIGÉE

Toute la couleur passe par des variables CSS déclarées sur `:root`.
La base espresso est **fixe** (c'est la signature). Seul `--accent` est thémable.

| Variable          | Hex       | Rôle |
|-------------------|-----------|------|
| `--bg`            | `#171210` | Fond général de l'app (espresso quasi-noir, chaud) |
| `--bg-elevated`   | `#1F1815` | Sidebar, barre de lecture, top bar |
| `--surface`       | `#241C18` | Cartes, lignes de piste, inputs, modales |
| `--surface-hover` | `#2E241E` | Survol des cartes / lignes / items de nav |
| `--border`        | `#3A2D25` | Filets et séparateurs (contraste faible, chaud) |
| `--text`          | `#F1E7DA` | Texte principal (os / crème) |
| `--text-muted`    | `#AE9F90` | Texte secondaire (artiste, labels, gris chaud) |
| `--text-dim`      | `#7C6F62` | Texte tertiaire (placeholders, méta discrète) |
| `--accent`        | `#E8A13C` | Accent (ambre lampe de studio) — **thémable par utilisateur** |
| `--accent-hover`  | `#F3B354` | Survol des éléments accent |
| `--accent-dim`    | `#A9772C` | Remplissage des barres (progression, volume), états subtils |
| `--positive`      | `#93A96B` | Indicateur « dans ma bibliothèque » (sauge douce, jamais néon) |
| `--danger`        | `#C65C3A` | Actions destructrices (terracotta) |
| `--focus-ring`    | accent à 40 % d'opacité | Anneau de focus clavier |

Règles :

- **Interdits** : `#121212`, glassmorphisme / `backdrop-filter`, dégradés violets/bleus
  décoratifs, néon, ombres colorées.
- Le texte sur fond accent est toujours `#171210` (encre espresso sur ambre) — jamais blanc.
- Les ombres sont noires et discrètes : `0 8px 24px rgba(0,0,0,.45)` (modales, menus),
  `0 4px 12px rgba(0,0,0,.35)` (cartes survolées). Pas d'autre élévation.

### Système d'accent thémable

- `users.accent_color` (hex) est injecté au chargement de la session :
  `document.documentElement.style.setProperty('--accent', couleur)`.
- `--accent-hover` et `--accent-dim` sont **dérivées en JS** de l'accent choisi
  (éclaircissement ~+10 % / assombrissement ~-25 % en HSL) pour rester cohérentes.
- Défaut : ambre `#E8A13C`.

### Couleur de playlist (fallback en cascade)

L'en-tête d'une playlist est teinté par, dans l'ordre :
1. `playlists.bg_color` si défini (choisi par le propriétaire) ;
2. sinon `--accent` de l'utilisateur courant.

Le teintage est un **dégradé fonctionnel** (pas décoratif) : couleur à ~55 % d'opacité
en haut de l'en-tête → fondu vers `--bg` sur ~260 px. C'est le seul dégradé de l'app,
même rôle que chez Spotify : la couleur « coule » de la pochette.

---

## 2. Typographie (self-hostée, woff2, aucun CDN)

| Famille | Graisses | Usage |
|---|---|---|
| **Hanken Grotesk** | 400 / 500 / 600 / 700 | Toute l'interface : titres, corps, boutons, nav |
| **IBM Plex Mono** | 400 / 500 | Données « compteur hi-fi » : durées, temps du lecteur (`0:50 / 2:35`), numéros de piste, dates, codes provisoires, stats |

Échelle (px) : **12 / 13 / 14 / 16 / 20 / 28 / 40**

- 40 / 700 — titre de playlist et de la bibliothèque (en-tête coloré)
- 28 / 700 — titres de page (Importer, Paramètres, Administration)
- 20 / 600 — titres de section, nom dans les cartes de la page d'accueil
- 16 / 500 — titre de piste (ligne + lecteur)
- 14 / 400 — corps par défaut, formulaires, boutons
- 13 / 400 — artiste sous le titre, « Ajouté par », méta
- 12 / 400 — labels en capitales espacées (`letter-spacing: .08em`), en-têtes de colonnes

Règles mono : tout ce qui est **chiffre aligné** (durée, position, temps) est en
IBM Plex Mono, couleur `--text-muted`, avec `font-variant-numeric: tabular-nums`.
Le mono ne sert jamais pour du texte courant.

`line-height` : 1.45 corps, 1.1 titres. `font-smoothing: antialiased`.

---

## 3. Espacement, rayons, élévation

**Espacement — base 4** : `4, 8, 12, 16, 24, 32, 48`.
- Padding zone principale : 24 (haut/bas) × 32 (côtés).
- Sidebar : 240 px de large, padding 16.
- Barre de lecture : 88 px de haut, padding 12 × 16.
- Grille de cartes : gap 16. Lignes de piste : hauteur 56 px.

**Rayons (industriel, faibles)** :
- `4px` — boutons, inputs, petites tuiles, badges
- `6px` — cartes, pochettes (miniatures et grandes)
- `8px` — modales, menus contextuels
- **Cercle** — bouton play principal, avatars, pastilles utilisateur

**Élévation** : 3 niveaux seulement — fond (`--bg`), élevé (`--bg-elevated`), surface
(`--surface`). Les ombres n'apparaissent que sur modales/menus (voir §1).

---

## 4. Iconographie & mouvement

- Icônes **type Lucide**, SVG inline bundlés localement dans `public/js/icons.js`
  (aucun CDN). Trait `stroke-width: 2`, `currentColor`, tailles 16 / 20 / 24.
- Icônes en `--text-muted` par défaut, `--text` au survol, `--accent` quand actives
  (shuffle actif, repeat actif).
- **Mouvement discret** : `transition: 140ms ease-out` sur couleur, fond, opacité,
  transform léger. Aucune animation d'entrée tape-à-l'œil, pas de rebond, pas de
  parallaxe. Seules exceptions : apparition des modales (fade + translateY 8 px,
  140 ms) et le spinner d'import (rotation continue).

---

## 5. Layout global

```
┌────────────┬─────────────────────────────────────────┐
│  Sidebar   │  Zone principale (scrollable)           │
│  240px     │  ┌ en-tête coloré (playlist/accent)     │
│  --bg-elev │  └ contenu                              │
│            │                                         │
├────────────┴─────────────────────────────────────────┤
│  Barre de lecture fixe — 88px — --bg-elevated        │
└──────────────────────────────────────────────────────┘
```

- **Sidebar (240 px, `--bg-elevated`, filet droit `--border`)** :
  logo **Melovo** (Hanken 700, 20 px, pastille ambre), navigation
  (Accueil, Recherche, Importer — icône 20 + libellé 14/500),
  séparateur `--border`, label « BIBLIOTHÈQUE » (12 capitales espacées, `--text-dim`),
  entrée « Ma bibliothèque », puis la liste des playlists : mini-pochette 32 px
  (rayon 4) + nom (14, tronqué). Item actif : fond `--surface-hover`, texte `--text`,
  barre de 3 px accent à gauche.
- **Top bar** de la zone principale : fine (56 px), avatar utilisateur à droite
  (cercle 32 px, initiale sur fond accent) → menu : Paramètres, Administration
  (si admin), Déconnexion.
- **Zone principale** : fond `--bg`, scroll indépendant, l'en-tête coloré scrolle
  avec le contenu.
- **Barre de lecture** : fixe, pleine largeur, au-dessus de tout (voir §6.7).
- Desktop-first ; sous 900 px la sidebar se réduit à des icônes (64 px), la colonne
  « Ajouté par » et la date se masquent dans les listes.

---

## 6. Spécifications de composants

### 6.1 Boutons

| Variante | Style | Usage |
|---|---|---|
| **Primaire** | fond `--accent`, texte `#171210`, 600, rayon 4, padding 8×16 ; hover `--accent-hover` | Valider, Créer, Se connecter |
| **Secondaire** | fond transparent, bord `--border`, texte `--text` ; hover fond `--surface-hover` | Annuler, actions neutres |
| **Fantôme / icône** | icône seule 32×32, `--text-muted` ; hover `--text` + fond `--surface-hover` | contrôles, menus `…` |
| **Danger** | comme secondaire mais texte + bord `--danger` ; hover fond `--danger` à 12 % | Supprimer |
| **Play rond (hero)** | cercle 56 px, fond `--accent`, triangle `#171210` ; hover `--accent-hover` + `transform: scale(1.04)` | en-tête playlist/bibliothèque |
| **Play rond (lecteur)** | cercle 40 px, mêmes couleurs | barre de lecture |

Désactivé : opacité .45, `cursor: not-allowed`, pas de hover.

### 6.2 Ligne de piste (table des titres)

Colonnes : `#` (mono, 12, `--text-dim`, largeur 32) · **Pochette 40 px** (rayon 4) ·
**Titre** (16/500 `--text`) avec artiste dessous (13 `--text-muted`) ·
**Ajouté par** (avatar-pastille 24 px + pseudo 13 `--text-muted`) ·
**Date d'ajout** (mono 12 `--text-dim`) · **Durée** (mono 13 `--text-muted`) ·
**`…`** (apparaît au survol).

États :
- hover : fond `--surface-hover` ; le `#` devient un bouton play ; poignée de drag
  visible (playlist éditable).
- **piste en cours** : titre en `--accent` + petite icône « égaliseur » animée
  discrète (3 barres, 1 s, uniquement pendant la lecture).
- drag & drop : ligne saisie en opacité .5, filet accent de 2 px à la position cible.

En-tête de colonnes : 12 capitales espacées `--text-dim`, filet bas `--border`,
sticky sous l'en-tête coloré.

### 6.3 En-tête de collection (playlist / bibliothèque)

Dégradé fonctionnel (§1) + pochette 192 px (rayon 6, ombre discrète) ou, à défaut,
tuile placeholder (icône note sur `--surface`). À droite : label
« PLAYLIST » / « BIBLIOTHÈQUE » (12 capitales), **nom en 40/700**, puis ligne méta
13 `--text-muted` : propriétaire · N titres · durée totale (mono).
Dessous, la rangée d'actions : play rond 56, shuffle, `+` (ajouter des titres /
enregistrer), `…` (modifier, partager, supprimer — selon droits).

### 6.4 Cartes (accueil, résultats)

Tuile `--surface`, rayon 6, padding 12 : pochette carrée pleine largeur (rayon 4),
nom 14/600 tronqué, sous-ligne 13 `--text-muted`. Hover : fond `--surface-hover` +
bouton play rond 40 px qui apparaît en bas à droite de la pochette (fade 140 ms).

### 6.5 Formulaires & modales

- **Input** : fond `--bg`, bord `--border`, rayon 4, padding 8×12, texte 14 ;
  placeholder `--text-dim` ; focus : bord `--accent` + anneau `--focus-ring` ;
  erreur : bord `--danger` + message 13 `--danger` dessous.
- **Label** : 12 capitales espacées `--text-muted`, marge basse 4.
- **Color picker** : rangée de pastilles rondes 28 px (palette proposée) +
  `<input type="color">` ; pastille sélectionnée : anneau accent 2 px.
- **Modale** : fond `--surface`, rayon 8, ombre forte, largeur 420–480 px,
  padding 24 ; titre 20/600 ; overlay `rgba(0,0,0,.6)` ; fermeture par Échap,
  clic overlay ou `×`. Actions alignées à droite : secondaire puis primaire.
- **Upload de pochette** : zone carrée 128 px en pointillés `--border`, icône image ;
  aperçu immédiat après sélection (recadrage carré visuel).

### 6.6 États génériques

| État | Traitement |
|---|---|
| Hover | fond `--surface-hover` et/ou texte éclairci, 140 ms |
| Actif / sélectionné | texte `--text`, barre accent 3 px (nav) ou icône accent + point de 4 px dessous (shuffle/repeat) |
| Focus clavier | `outline: 2px solid var(--focus-ring); outline-offset: 2px` — jamais supprimé sans remplacement |
| Désactivé | opacité .45, interactions coupées |
| « Enregistré / dans ma bibliothèque » | coche cerclée `--positive` (16 px) + info-bulle « Dans votre bibliothèque » |
| Erreur | texte/bord `--danger`, message clair en français, jamais de code brut |
| Vide | icône 40 px `--text-dim`, phrase 14 `--text-muted`, action primaire si pertinente (ex. « Importer un titre ») |
| Chargement | spinner cercle 20 px trait accent ; import YouTube : barre de progression `--accent-dim`→`--accent` + pourcentage mono |

### 6.7 Barre de lecture (fixe, 88 px, `--bg-elevated`, filet haut `--border`)

Trois zones en grille `1fr auto 1fr` :

- **Gauche** : pochette 56 px (rayon 4) · titre 14/500 `--text` (tronqué) · artiste
  13 `--text-muted` · coche `--positive` si le titre est dans ma bibliothèque.
- **Centre** : `shuffle · précédent · play/pause · suivant · repeat`.
  Play = cercle accent 40 px (icône `#171210`). Shuffle/repeat actifs : icône
  accent + point 4 px dessous. Repeat-one : badge « 1 » sur l'icône.
- **Droite** : temps écoulé (mono 12) · **barre de progression** (piste `--surface`,
  4 px, rempli `--accent-dim` ; au survol : rempli `--accent` + poignée ronde 12 px ;
  cliquable/glissable pour le seek) · durée totale (mono 12) · icône volume +
  glissière 88 px (mêmes règles).

Format temps : `m:ss` (ex. `0:50 / 2:35`), toujours en mono.

### 6.8 Toasts

En bas à droite au-dessus du lecteur, `--surface` + bord `--border`, rayon 6,
14 px, icône d'état (accent = info, `--positive` = succès, `--danger` = erreur),
auto-fermeture 4 s. Un seul toast à la fois.

---

## 7. Voix & microcopie

Tout en **français**, ton simple et direct : « Ajouter à une playlist »,
« Enregistrer dans ma bibliothèque », « Ajouté par thibaud.jourdan ».
Erreurs actionnables : « Lien YouTube invalide ou vidéo indisponible. »
Dates relatives courtes (« il y a 3 jours »), au format `JJ/MM/AAAA` au-delà de 30 jours.
