# Les paroles à la maison : le cache local et votre propre miroir LRCLIB

*English: [Lyrics at home](lyrics-database.md)*

Le compagnon trouve ses paroles sur [LRCLIB](https://lrclib.net), une base communautaire gratuite.
Deux choses le font fonctionner quand lrclib.net est lent ou en panne :

1. **Le cache local** : actif par défaut, rien à régler. Chaque parole trouvée est gardée sur votre
   ordinateur : un morceau déjà écouté n'a plus jamais besoin de LRCLIB.
2. **Votre propre miroir LRCLIB** (facultatif) : une copie complète de la base LRCLIB sur un NAS ou
   un serveur chez vous. Les morceaux jamais écoutés sont trouvés aussi, sans lrclib.net, et les
   recherches restent sur votre réseau.

- [Le cache local](#1-le-cache-local)
- [Votre propre miroir LRCLIB](#2-votre-propre-miroir-lrclib) : [ce qu'il faut](#ce-quil-faut) ·
  [installation](#installation-pas-à-pas) · [brancher le compagnon](#étape-6--brancher-le-compagnon) ·
  [mise à jour](#passer-à-un-export-plus-récent) · [sécurité](#sécurité) · [dépannage](#dépannage)

---

## 1. Le cache local

### Ce qu'il garde

| Gardé | D'où ça vient |
|---|---|
| Les paroles de chaque morceau pour lequel le compagnon en a trouvé | LRCLIB, pendant la lecture ou dans la file d'attente (les trois morceaux suivants sont cherchés à l'avance) |
| La version que vous avez choisie | **Versions** |
| Les paroles que vous avez modifiées ou synchronisées | L'éditeur LRC |
| Les paroles écrites par le remplissage de la bibliothèque | Le remplissage depuis LRCLIB de la carte *Paroles de la bibliothèque* (voir [votre bibliothèque](guide/library.fr.md)) |
| Votre décalage et la version choisie, par morceau | `lyrics-prefs.json`, à côté du cache |

Chaque entrée est un petit fichier texte `.lrc` de quelques Ko : mille morceaux font quelques Mo.
Un morceau est reconnu par **artiste + titre + album** : le même titre sur un autre album est
recherché à nouveau.

À côté de *Paroles*, la pastille indique **Copie enregistrée** quand les paroles viennent du cache.
Réglages → Préférences de l'application → *Diagnostics — Infos système* → **Charger** affiche sa
taille et son nombre de fichiers (app de bureau).

Rien n'est écrit sur le disque pour les échecs : « pas de paroles pour ce morceau » est retenu
30 minutes, une recherche échouée une minute, pour qu'un morceau absent n'interroge pas LRCLIB à
chaque écoute. Les deux sont oubliés au redémarrage du compagnon.

### Où il se trouve

| Installation | Cache | Décalages et versions |
|---|---|---|
| **macOS** | `~/Library/Application Support/roon-companion-textfromtrack/storage/lrc-cache/` | `…/storage/lyrics-prefs.json` |
| **Windows** | `%APPDATA%\roon-companion-textfromtrack\storage\lrc-cache\` | `…\storage\lyrics-prefs.json` |
| **Linux** | `~/.config/roon-companion-textfromtrack/storage/lrc-cache/` | `…/storage/lyrics-prefs.json` |
| **Docker** | `data/lrc-cache/` dans le dossier monté sur `/app/src/storage` | `data/lyrics-prefs.json` |
| **Node.js** | `src/storage/lrc-cache/` | `src/storage/lyrics-prefs.json` |

Il survit aux mises à jour. Dans Docker, il est dans votre dossier `data` monté : il survit aussi à la
recréation du conteneur.

### Le sauvegarder, le déplacer, repartir de zéro

- **Sauvegarder ou déplacer :** copiez le dossier `storage` (Docker : `data`). Il contient aussi vos
  réglages et l'appairage avec Roon.
- **Repartir de zéro :** quittez l'app (Docker : `docker compose stop`), supprimez `lrc-cache`,
  relancez. Supprimez aussi `lyrics-prefs.json` pour oublier décalages et choix de versions. Les
  paroles modifiées dans l'éditeur LRC sans les enregistrer dans un fichier audio n'existent que dans
  le cache : exportez-les d'abord (**Télécharger** dans le lecteur) si vous voulez les garder.
- **Une seule parole fausse :** inutile de vider quoi que ce soit, **Versions** la remplace pour ce
  morceau.

Le cache ne connaît que les morceaux déjà écoutés. Pour les autres, il faut qu'un serveur réponde :
lrclib.net, ou un miroir.

---

## 2. Votre propre miroir LRCLIB

LRCLIB publie toute sa base en téléchargement, et son serveur est open source (MIT,
[tranxuanthang/lrclib](https://github.com/tranxuanthang/lrclib)). Faites tourner les deux chez vous, et
le compagnon interroge votre copie en premier.

**Utile quand :**
- lrclib.net est en panne ou surchargé et que vous ne voulez pas attendre ;
- vous voulez que les recherches restent sur votre réseau : sans lrclib.net dans la liste, rien de ce
  que vous écoutez ne sort de chez vous ;
- plusieurs écrans ou compagnons cherchent des paroles toute la journée.

**Pas la peine** sans machine allumée en permanence avec ~320 Go libres : le cache seul couvre déjà
les morceaux que vous écoutez souvent.

### Ce qu'il faut

| | |
|---|---|
| **Disque** | ~50 Go pour l'export compressé, ~270 Go pour la base, ~1,5 Go pour l'index de recherche (export d'octobre 2026). Mieux vaut un SSD pour la base. Un disque dur fonctionne, mais chaque recherche prend environ 0,2 s. |
| **Mémoire** | Le serveur utilise ce que ses réglages lui permettent (`LRCLIB_MMAP_SIZE` et `mem_limit`, plus bas) : sur un NAS de 32 Go de RAM, une limite de 12 Go suffisait largement. Avec moins de RAM, baissez les deux. |
| **Docker** | Sur la machine du miroir, plus `git` et Docker sur la machine qui construit l'image (ce peut être la même). |
| **Réseau** | Le compagnon doit joindre le miroir : même réseau local, adresse fixe. |
| **Temps** | Le téléchargement dépend de votre connexion (49 Go). La décompression prend ~20 min sur SSD, le premier index de recherche ~5 min. |

L'export d'octobre 2026 contient 34,6 millions de morceaux, dont 22,4 millions avec paroles
synchronisées.

### Installation pas à pas

Les exemples utilisent le dossier `/srv/lrclib` : remplacez-le par le vôtre, par exemple un dossier
partagé de votre NAS. Remplacez aussi `192.168.1.20` par l'adresse locale de la machine du miroir.

#### Étape 1 — Télécharger l'export

Les exports sont listés sur **[lrclib.net/db-dumps](https://lrclib.net/db-dumps)**, sous la forme de
fichiers nommés `lrclib-db-dump-<date>.sqlite3.gz`. Prenez le plus récent, copiez son lien, et
téléchargez-le là où vous avez de la place. `-C -` reprend après une coupure :

```bash
mkdir -p /srv/lrclib/dumps && cd /srv/lrclib/dumps
curl -fL -C - --retry 20 --retry-delay 30 -o lrclib-db-dump-<date>.sqlite3.gz '<lien copié depuis la page>'
gzip -t lrclib-db-dump-<date>.sqlite3.gz && echo "export OK"   # vérifie tout le fichier ; prend du temps
```

Si le téléchargement est coupé, relancez la même commande `curl` : il reprend.

#### Étape 2 — Le décompresser

La base occupe environ **5,5 fois** la taille de l'export. Vérifiez d'abord la place libre
(`df -h /srv/lrclib`) :

```bash
mkdir -p /srv/lrclib/data/db /srv/lrclib/data/index
gzip -dc /srv/lrclib/dumps/lrclib-db-dump-<date>.sqlite3.gz > /srv/lrclib/data/db/lrclib-<date>.sqlite3
```

Garder la date dans le nom permet d'installer plus tard un export plus récent à côté de l'ancien.

Vérification facultative, si `sqlite3` est installé :

```bash
sqlite3 -readonly /srv/lrclib/data/db/lrclib-<date>.sqlite3 'PRAGMA user_version; SELECT max(id) FROM tracks;'
```

Le second nombre doit se compter en dizaines de millions.

Gardez le `.gz` comme copie de secours sur un autre disque, ou supprimez-le une fois le miroir en
service.

#### Étape 3 — Construire l'image du serveur

LRCLIB ne publie pas d'image toute prête : on la construit depuis ses sources. Comptez ~7 minutes sur
un ordinateur récent.

```bash
git clone https://github.com/tranxuanthang/lrclib.git
cd lrclib
git rev-parse --short HEAD          # notez-le : le projet n'a pas de numéros de version
docker build -t lrclib-server .
```

Pour construire sur votre ordinateur pour un NAS d'un autre type (un Mac Apple silicon est `arm64`,
la plupart des NAS sont `amd64`) :

```bash
docker buildx build --platform linux/amd64 -t lrclib-server --load .
docker save lrclib-server | gzip > lrclib-server.tar.gz
# copiez lrclib-server.tar.gz sur le NAS, puis sur le NAS :
docker load < lrclib-server.tar.gz
```

#### Étape 4 — Le fichier compose

Dans `/srv/lrclib`, créez les deux fichiers ci-dessous.

Le **serveur** répond sur le port 3300, à l'intérieur de Docker seulement. Un petit proxy **Caddy**
devant lui le publie sur votre adresse locale et ne laisse passer que les recherches. Le serveur
LRCLIB accepte aussi l'envoi de paroles et les signalements : sans le proxy, n'importe qui sur votre
réseau pourrait écrire dans votre copie.

`docker-compose.yml` :

```yaml
name: lrclib-mirror

services:
  lrclib:
    image: lrclib-server
    restart: unless-stopped
    command: ["lrclib", "serve", "--port", "3300", "--database", "/data/db/lrclib-<date>.sqlite3"]
    environment:
      LRCLIB_LOG: info
      # Part de la base gardée en mémoire, en octets. Restez sous 75 % de la RAM disponible :
      # 8 Gio ici, pour une machine de 16 Go ou plus. Baissez-la sur une petite machine.
      LRCLIB_MMAP_SIZE: "8589934592"
      # Un index de recherche par fichier de base : un export plus récent ne réutilise jamais un ancien index.
      LRCLIB_SEARCH_INDEX_DIR: /data/index/lrclib-<date>.sqlite3.tantivy
    volumes:
      # En lecture-écriture exprès : le serveur prépare la base au démarrage.
      # C'est le proxy ci-dessous qui rend le miroir en lecture seule.
      - ./data/db:/data/db
      - ./data/index:/data/index
    mem_limit: 12g
    security_opt:
      - no-new-privileges:true

  proxy:
    image: caddy:2.10.2-alpine
    restart: unless-stopped
    depends_on:
      - lrclib
    ports:
      # L'adresse locale de la machine du miroir, jamais 0.0.0.0, jamais redirigée par votre box.
      - "192.168.1.20:3300:3300"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
    read_only: true
    tmpfs:
      - /data
      - /config
    cap_drop:
      - ALL
    cap_add:
      - NET_BIND_SERVICE   # nécessaire à l'image Caddy, sinon elle ne démarre pas
    security_opt:
      - no-new-privileges:true
```

`Caddyfile` :

```caddyfile
{
	admin off
	auto_https off
}

:3300 {
	request_body {
		max_size 4KB
	}

	@read {
		method GET HEAD
		path /api/get /api/get/* /api/search
	}
	@write path /api/request-challenge /api/publish /api/flag

	route {
		respond /healthz "ok" 200
		reverse_proxy @read lrclib:3300
		respond @write "read-only mirror" 403
		respond "not found" 404
	}
}
```

Le compagnon n'utilise que `/api/get`, `/api/get/<id>` et `/api/search`.

#### Étape 5 — Démarrer et vérifier

```bash
cd /srv/lrclib
docker compose up -d
docker compose logs -f lrclib        # Ctrl-C pour sortir
```

Depuis un autre ordinateur du réseau :

```bash
# Une recherche exacte : fonctionne dès que le serveur est démarré
curl -s 'http://192.168.1.20:3300/api/get?artist_name=Josh+Woodward&track_name=The+Nest' | head -c 300

# Une recherche approchée : répond une erreur tant que l'index n'est pas construit (~5 min la première fois)
curl -s 'http://192.168.1.20:3300/api/search?q=josh+woodward+the+nest' | head -c 300

# Les écritures sont refusées : attendu 403
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://192.168.1.20:3300/api/publish
```

La première réponse est du JSON avec `"trackName":"The Nest"` et un champ `syncedLyrics`. Si la
recherche approchée échoue encore après 15 minutes, regardez `docker compose logs lrclib`.

#### Étape 6 — Brancher le compagnon

Réglages → **Sources de paroles** :

1. Ajoutez `http://192.168.1.20:3300`.
2. Placez-le **au-dessus** de `lrclib.net` avec ↑.
3. Appuyez sur **Tester** : il doit indiquer que le serveur répond.

Installation Docker ou sans écran : utilisez plutôt la variable d'environnement. Le réglage fait dans
l'app l'emporte sur elle.

```yaml
LRCLIB_URLS: http://192.168.1.20:3300,https://lrclib.net
```

Dans Docker, **Tester** vérifie depuis l'intérieur du conteneur : si le test échoue là mais que
l'adresse répond depuis votre ordinateur, le conteneur ne la joint pas. Lancez-le avec
`network_mode: host`, comme dans le [docker-compose.yml](../docker-compose.yml) du compagnon.

### Comment le compagnon utilise la liste

- Les serveurs sont interrogés **dans l'ordre** ; le premier qui a le morceau répond.
- **Absent du miroir** → le serveur suivant est interrogé. Un export est une photo à une date : les
  morceaux ajoutés à LRCLIB depuis ne sont que sur lrclib.net. Gardez lrclib.net en dernier pour les
  avoir.
- **Miroir injoignable ou plus lent que 5 s** → le serveur suivant est interrogé, et le miroir est
  ignoré pendant une minute : un miroir éteint ne ralentit pas chaque morceau.
- **Surchargé (503/429)** → le serveur suivant est interrogé tout de suite ; le dernier a droit à un
  nouvel essai.
- « Pas de paroles » n'est décidé que par le **dernier** serveur. S'il échoue, le morceau est signalé
  en erreur, pas « sans paroles », et une nouvelle tentative a lieu une minute plus tard.
- **Confidentialité :** chaque serveur interrogé reçoit le titre, l'artiste, l'album et la durée du
  morceau. Avec le miroir en premier, les morceaux qu'il connaît n'atteignent jamais lrclib.net.
  Retirez lrclib.net de la liste pour que tout reste chez vous, au prix des morceaux plus récents que
  votre export.

Jusqu'à 5 serveurs. Plusieurs compagnons, sur plusieurs ordinateurs, peuvent partager un même miroir.

### Passer à un export plus récent

LRCLIB publie de temps en temps un nouvel export ; le vôtre continue de fonctionner en attendant. Pour
changer :

1. Téléchargez et décompressez le nouvel export comme aux étapes 1–2, **sous un nouveau nom**. Il faut
   la place pour les deux bases pendant le changement.
2. Dans `docker-compose.yml`, changez la date dans `--database` et dans `LRCLIB_SEARCH_INDEX_DIR`.
3. `docker compose up -d`. Les recherches exactes marchent tout de suite ; la recherche approchée
   revient une fois son nouvel index construit, ~5 minutes.
4. Vérifiez comme à l'étape 5, puis supprimez l'ancienne base et son dossier d'index `.tantivy`.

Pour revenir en arrière : remettez l'ancien nom de fichier à l'étape 2, puis `docker compose up -d`.
L'ancien index est encore là : la recherche marche tout de suite.

Si le serveur s'arrête juste après le changement et que son journal parle de version de base ou de
migration, le nouvel export demande un serveur plus récent : `git pull` dans le dossier `lrclib`,
reconstruisez l'image (étape 3), relancez.

### Sécurité

- **Gardez-le sur votre réseau local.** Publiez le proxy sur l'adresse locale seulement et ne
  redirigez pas le port sur votre box : le miroir n'a aucune authentification.
- **Lecture seule :** le proxy ne laisse passer que les recherches, les écritures reçoivent `403`. La
  base reste identique à l'export.
- **Aucun secret :** les données sont publiques, il n'y a pas de mot de passe à garder.
- **Sauvegardes :** rien d'autre que le `.gz`, si vous le gardez. Les données peuvent toujours être
  retéléchargées.

### Dépannage

| Symptôme | Cause probable, solution |
|---|---|
| **Tester** dans Sources de paroles : injoignable ou délai dépassé | Mauvaise adresse ou mauvais port, le pare-feu de la machine (ouvrez le 3300 au réseau local dans les réglages du NAS), ou le compagnon dans un réseau Docker « bridge » : utilisez `network_mode: host`. |
| **Tester** dit que ce n'est pas un serveur LRCLIB | L'adresse répond, mais c'est un autre service, ou le proxy sans le serveur derrière : `docker compose ps`. |
| Les recherches exactes marchent, la recherche approchée échoue | L'index de recherche est encore en construction : patientez, suivez `docker compose logs lrclib`. |
| Le serveur s'arrête aussitôt, son journal parle d'une base en lecture seule | Le dossier de la base est monté en lecture seule, ou Docker ne peut pas y écrire. Il doit être en lecture-écriture ; c'est le proxy qui garde le miroir en lecture seule. |
| Le proxy s'arrête aussitôt, `operation not permitted` | Il manque `cap_add: NET_BIND_SERVICE` à côté de `cap_drop: ALL`. |
| Un morceau est trouvé sur lrclib.net mais pas sur le miroir | Il a été ajouté après votre export. Avec lrclib.net en dernier dans la liste, le compagnon le trouve quand même. |
| Recherches lentes | Base sur un disque dur, ou peu de mémoire. Déplacez la base sur un SSD, ou augmentez `LRCLIB_MMAP_SIZE` si vous avez de la RAM disponible. |
| Le serveur est tué (mémoire épuisée) | Baissez `LRCLIB_MMAP_SIZE`, ou augmentez `mem_limit`. |

Plus de détails sur le serveur et ses réglages dans [son README](https://github.com/tranxuanthang/lrclib).
Le compagnon n'est pas affilié à LRCLIB.
