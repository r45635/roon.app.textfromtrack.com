# Démarrage rapide — TextFromTrack Roon Companion

Les paroles synchronisées de tout ce que joue Roon, en cinq minutes. Aucun dossier musical nécessaire.

*English: [quickstart.md](quickstart.md)*

## 1. Installer

Choisissez **une** option. Téléchargements : [dernière version](https://github.com/r45635/roon.app.textfromtrack.com/releases/latest).

| Où | Fichier | Premier lancement |
|---|---|---|
| **Mac** (Apple Silicon) | `TextFromTrack.Companion-<version>-arm64.dmg` | Glissez l'app dans Applications et ouvrez-la. macOS indique qu'il ne peut pas vérifier le développeur : **Réglages Système → Confidentialité et sécurité → Ouvrir quand même**. Puis **Autoriser** quand il demande l'accès au *Réseau local* (nécessaire pour joindre Roon). |
| **Mac** (Intel) | `TextFromTrack.Companion-<version>.dmg` | Comme ci-dessus. |
| **Windows** | `TextFromTrack.Companion.Setup.<version>.exe` | SmartScreen peut avertir : **Informations complémentaires → Exécuter quand même**. |
| **Linux** | `.AppImage` (toutes distributions) ou `.deb` | AppImage : `chmod +x` sur le fichier, puis lancez-le. |
| **NAS / serveur** (Docker) | `docker compose up -d` avec le [docker-compose.yml](../docker-compose.yml) | Hôte Linux : gardez `network_mode: host`. Docker Desktop (Mac/Windows) : utilisez le bloc `ports` et renseignez `ROON_CORE_HOST` avec l'IP de votre Core. |

L'app de bureau vit dans la barre des menus (Mac) ou la zone de notification (Windows/Linux) :
elle démarre le compagnon et ouvre l'interface dans votre navigateur.

## 2. L'activer dans Roon

Dans Roon : **Paramètres → Extensions → TextFromTrack Roon Companion → Activer**.

La page du compagnon affiche *« Activez l'extension dans Roon »* tant que ce n'est pas fait.

## 3. Lancer de la musique

Ouvrez l'interface (icône de la barre des menus → **Open UI**, ou `http://localhost:3888`) et lancez
n'importe quel titre dans Roon — streaming compris. Les paroles apparaissent sous le lecteur, ligne par ligne.

- **Cliquez sur une ligne** pour y aller ; **Décalage − / +** si elles arrivent trop tôt ou trop tard.
- **Plein écran** : touche **F**.
- **Sur un téléphone, une tablette ou une TV** : l'icône téléphone en haut affiche les QR codes de
  l'app et d'un affichage plein écran des paroles.

Les paroles viennent de [LRCLIB](https://lrclib.net), une base communautaire gratuite. Si un titre
n'en a pas, essayez **Versions**.

## 4. En option

- **Votre dossier musical** (Réglages → Paramètres bibliothèque) : lire et écrire les paroles dans vos fichiers,
  remplir toute la bibliothèque depuis LRCLIB, synchroniser vous-même — voir le [guide de la bibliothèque](guide/library.fr.md).
- **Paroles IA — bientôt** : [TextFromTrack](https://app.textfromtrack.com) écrira des paroles synchronisées pour
  les titres que personne n'a transcrits. Le service est encore en développement.
- **Jeton d'accès** (`ACCESS_TOKEN`) : l'exiger des autres appareils du réseau.

## Ça ne marche pas ?

| Vous voyez | Faites |
|---|---|
| « Recherche de votre Roon Core… » plus d'une minute | Roon et le compagnon doivent être sur le même réseau. Dans Docker ou entre sous-réseaux, renseignez `ROON_CORE_HOST` avec l'IP du Core. |
| « macOS bloque la connexion » | Réglages Système → Confidentialité et sécurité → **Réseau local** → activez TextFromTrack Companion. |
| L'extension n'apparaît pas dans Roon | Redémarrez le compagnon ; vérifiez que le Core est en Roon 2.x (port 9330). |
| « LRCLIB est surchargée » | La base gratuite est occupée ; l'app réessaie seule. |

Plus : [FAQ](faq.fr.md) · [guide du lecteur](guide/player.fr.md) · [guide de la bibliothèque](guide/library.fr.md) · [guide d'installation complet](install.md) ·
[signaler un problème](https://github.com/r45635/roon.app.textfromtrack.com/issues)

*Sans lien avec Roon Labs.*
