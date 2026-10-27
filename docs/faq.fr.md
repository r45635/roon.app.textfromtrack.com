# FAQ — TextFromTrack Roon Companion

*English: [faq.md](faq.md) · [Démarrage rapide](quickstart.fr.md) · [Le lecteur](guide/player.fr.md) · [Votre bibliothèque](guide/library.fr.md)*

**Est-ce que ça modifie quelque chose dans Roon ?**
Non. C'est une extension Roon qui lit ce que jouent les zones et envoie les commandes que vous
utilisez (lecture, position, volume…). Elle ne modifie jamais votre bibliothèque Roon. Les paroles
n'arrivent dans vos fichiers que si vous indiquez un dossier musical et les y enregistrez — voir
[votre bibliothèque](guide/library.fr.md).

**Un titre n'a pas de paroles. Pourquoi ?**
Les paroles viennent de [LRCLIB](https://lrclib.net), une base communautaire gratuite : la plupart
des titres connus y sont, les plus rares peut-être pas. Essayez **Versions** avec un titre
simplifié. Des paroles IA pour le reste, avec TextFromTrack, arriveront plus tard — ce service est
encore en développement.

**Est-ce que ça marche avec Roon ARC ?**
Non. Le compagnon est une page web servie sur votre réseau local (`http://<ordinateur>:3888`) ; il
n'ajoute pas de paroles dans Roon ARC. Sur votre téléphone à la maison, scannez le QR code (icône
téléphone en haut).

**Faut-il un dossier musical ou un compte ?**
Non. Les paroles de tout ce que joue Roon fonctionnent sans l'un ni l'autre. Le dossier musical
ajoute seulement l'écriture des paroles dans vos fichiers.

**Est-ce que ça peut abîmer mes tags ?**
Non. Écrire des paroles ne modifie que les paroles (le cadre des paroles d'un MP3, le commentaire
LYRICS d'un FLAC) ; tous les autres tags et la vignette sont recopiés tels quels et vérifiés après
l'écriture. Une copie `.org` de l'original est gardée par défaut.

**Roon affiche-t-il les paroles écrites ?**
Roon lit les paroles intégrées aux tags de vos fichiers : dans les réglages d'importation de la
bibliothèque Roon (*Settings → Library → Import settings*), choisissez la préférence au fichier
(*Prefer file*) pour les paroles et les paroles synchronisées, puis laissez Roon réanalyser. Ne
comptez pas sur Roon pour lire les fichiers `.lrc` posés à côté des morceaux.

**macOS dit qu'il ne peut pas vérifier le développeur.**
L'app n'est pas encore notarisée par Apple. Ouvrez-la une fois, puis Réglages Système →
Confidentialité et sécurité → **Ouvrir quand même**. Autorisez l'accès au *Réseau local* quand il
est demandé — c'est ainsi que l'app joint Roon.

**macOS demande l'accès à un volume réseau.**
Cela arrive quand votre dossier musical est sur un partage NAS ou un disque externe : cliquez sur
**Autoriser**. Tant que ce n'est pas fait, l'analyse de la bibliothèque attend. L'app n'étant pas
encore signée par Apple, macOS redemande après chaque mise à jour. Vous l'avez manqué ? Réglages
Système → Confidentialité et sécurité → Fichiers et dossiers → TextFromTrack Companion → *Volumes
réseau*.

**Plusieurs écrans peuvent-ils afficher les paroles en même temps ?**
Oui. Chaque téléphone, tablette ou navigateur de TV peut ouvrir l'affichage des paroles, et chacun
suit sa propre zone (bouton **Zone**).

**Qu'est-ce qui sort de mon réseau ?**
Pour trouver les paroles, le titre, l'artiste, l'album et la durée d'un morceau partent vers
LRCLIB. Toutes les quelques heures, l'app demande à GitHub si une nouvelle version existe
(`UPDATE_CHECK=false` le désactive). Rien d'autre. Les autres appareils du réseau peuvent devoir
fournir un jeton (`ACCESS_TOKEN`).

**Docker sur un Mac ou un PC Windows ?**
Docker Desktop ne peut pas utiliser le réseau de l'hôte, donc Roon ne trouve pas le conteneur :
utilisez le bloc `ports` du [docker-compose.yml](../docker-compose.yml) et renseignez
`ROON_CORE_HOST` avec l'IP de votre Core.

**Autre chose ?** Ouvrez une [issue](https://github.com/r45635/roon.app.textfromtrack.com/issues) — le
mode capture d'écran (Préférences de l'application) masque vos noms et dossiers si vous joignez une
image.

*Sans lien avec Roon Labs.*
