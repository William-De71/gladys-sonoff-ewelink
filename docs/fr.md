# Sonoff / eWeLink

Pilotez vos appareils Sonoff et eWeLink depuis Gladys, en passant d'abord par
votre réseau local, avec le cloud eWeLink en secours facultatif. Les appareils
continuent de fonctionner sans internet, et le cloud complète ce qui manque
(clés de chiffrement, appareils Zigbee d'une passerelle, contrôle à distance).

![Illustration des widgets réseau et énergie Sonoff, pas une capture d'écran](https://raw.githubusercontent.com/William-De71/gladys-sonoff-ewelink/main/docs/assets/widgets-illustration.svg)

Cette intégration n'est affiliée ni à ITEAD (Sonoff) ni à CoolKit (eWeLink).

## Présentation

- **Le réseau local d'abord** : Gladys trouve les appareils sur le réseau
  (mDNS) et l'intégration leur envoie les commandes directement, chiffrées
  comme le fait l'app eWeLink. Les appareils en **mode DIY** n'ont besoin de
  rien d'autre.
- **Le cloud eWeLink, facultatif** : avec votre propre application
  développeur eWeLink, gratuite, l'intégration récupère les noms et les clés
  de chiffrement de vos appareils, les mises à jour en temps réel, un secours
  quand le réseau local fait défaut, et les appareils Zigbee d'une passerelle.
- Chaque appareil affiche un badge **Local / Cloud / Injoignable**, avec un
  point orange quand il fonctionne en mode dégradé (vu en local mais piloté
  par le cloud).

### Appareils pris en charge

Plus de 110 modèles eWeLink, repris du projet SonoffLAN : interrupteurs une
ou plusieurs voies (Basic, Mini, Micro, T1, TX Ultimate, M5), prises et
modules avec mesure (POW, POWR2, POWR3, S40, S60, DualR3, SPM-4Relay),
thermostats TH, éclairages (D1, B02, B05, L1, L3, ampoules Zigbee),
ventilateurs iFan, rideaux et portes de garage, capteurs Wi-Fi et Zigbee
(ouverture, mouvement, présence, fuite, température, humidité, qualité de
l'air), tête thermostatique TRVZB, NSPanel, sirène SNZB-09P, vannes d'eau et
RF Bridge 433.

## Prérequis

- Gladys Assistant **5.2.0** ou ultérieur.
- Des appareils sous le firmware eWeLink d'origine (ou en mode DIY), sur le
  même réseau que le serveur Gladys : le mDNS doit l'atteindre (pas d'isolation
  par VLAN ni d'isolation des clients sur le Wi-Fi).
- Les appareils qui ne sont pas en mode DIY chiffrent leurs messages avec une
  clé que seul le cloud eWeLink connaît. Pour les piloter en local, connectez
  le cloud une fois (les clés sont ensuite conservées), ou ajoutez chaque clé à
  la main.
- Pour le cloud : un compte gratuit sur le centre développeur eWeLink
  ([dev.ewelink.cc](https://dev.ewelink.cc)) et une application. Son quota
  gratuit est de 50 000 appels d'API par mois et par région : le WebSocket en
  temps réel n'en consomme presque pas.

## Configuration

### Réseau local

Le **contrôle par le réseau local** est actif par défaut. L'**intervalle de
recherche réseau** (60 s) règle la fréquence de recherche des adresses et des
états ; l'**intervalle de rafraîchissement local** (30 s) celle à laquelle
chaque appareil est interrogé sur son état (puissance, température...).

### Cloud eWeLink (facultatif)

1. Connectez-vous sur [dev.ewelink.cc](https://dev.ewelink.cc), faites la
   certification développeur, puis créez une application.
2. Dans Gladys, choisissez la connexion au cloud **Application développeur
   (OAuth)**, saisissez l'**App ID**, l'**App Secret** et la **région** de
   votre compte, puis **enregistrez**.
3. Copiez l'**URI de redirection à déclarer dans votre application
   développeur**, affichée avec le bouton **Connecter**, dans l'application du
   centre développeur eWeLink.
4. Cliquez sur **Connecter** et identifiez-vous avec votre compte eWeLink. Le
   badge de l'intégration passe à « Connecté ».

Le mode **E-mail et mot de passe** ne fonctionne qu'avec un App ID autorisé à
se connecter par mot de passe, ce que ne sont pas les App ID développeur
gratuits. Se connecter avec l'App ID d'une autre application peut déconnecter
cette application.

### Ajouter un appareil à la main

L'action **Ajouter un appareil à la main** prend l'ID de l'appareil (10
caractères, affiché dans l'app eWeLink), et en option son adresse IP et sa
clé. Utilisez-la pour un appareil que la recherche réseau ne voit pas, ou pour
piloter un appareil en local sans le cloud quand vous connaissez sa clé.

### Privilégier la connexion locale

Gladys affiche l'interrupteur standard **Privilégier la connexion locale (LAN)
quand elle est disponible**. Activé, les commandes passent par le réseau local
et se replient sur le cloud ; désactivé, le cloud passe en premier.

## Utilisation

### Découverte et création

Ouvrez l'onglet **Découverte** et lancez une recherche : les appareils trouvés
sur le réseau et dans votre compte eWeLink apparaissent, avec leur nom et leurs
fonctionnalités. Créez ceux que vous voulez : ils s'affichent dans l'onglet
**Appareils** et sur vos tableaux de bord.

### Déclencheurs de scène

- **Bouton Sonoff appuyé** : un bouton sans fil, une télécommande ou un
  interrupteur mural a signalé un appui. Filtrez par appareil, bouton (1 à 4)
  et appui (simple, double, long, triple). Variables : `button`, `press`,
  `device_name`.
- **Code RF reçu** : un RF Bridge a reçu un code appris (télécommande,
  détecteur d'ouverture ou de mouvement). Variables : `channel`, `name`,
  `device_name`.
- **Appareil Sonoff (dé)connecté** : un appareil n'est plus joignable, ou l'est
  de nouveau. Variables : `status`, `device_name`.
- **État du cloud eWeLink modifié** : connexion perdue, revenue, reconnexion
  requise ou quota épuisé. Variable : `status`.

### Actions de scène

- **Envoyer un code RF** : un RF Bridge envoie un code appris (numéro ou nom).
  Sorties : `sent`, `via`.
- **Envoyer une commande eWeLink** : des paramètres eWeLink bruts en JSON,
  pour ce que Gladys ne pilote pas (effets lumineux...). Sorties : `sent`,
  `via`.
- **Relancer la recherche Sonoff** : sorties `devices` et `reachable`.

### Widgets de tableau de bord

- **Réseau Sonoff** : appareils joints en local, par le cloud ou injoignables,
  session cloud, appels d'API du mois, appareils à surveiller, et un bouton
  **Relancer**.
- **Énergie Sonoff** : puissance, tension, intensité et consommation d'un
  appareil mesureur, sa puissance sur 24 heures et des boutons Allumer /
  Éteindre.
- **Télécommande RF** : jusqu'à quatre codes d'un RF Bridge en boutons, et les
  derniers codes reçus.

### Exemples de scènes

- Quand le **bouton de chevet** reçoit un double appui, éteindre toutes les
  lumières de la maison.
- Quand le RF Bridge reçoit le code de la **porte d'entrée** la nuit, allumer
  l'entrée et envoyer un message.
- Quand la **prise du congélateur** devient injoignable, envoyer une
  notification avec `{{triggerEvent.data.device_name}}`.

## Dépannage

- **Aucun appareil trouvé** : le serveur Gladys et les appareils doivent être
  sur le même réseau, avec le mDNS autorisé. Lancez l'action **Tester la
  connexion** : elle indique combien d'appareils répondent sur le réseau local.
- **Badge orange « vu sur le réseau, clé inconnue »** : l'appareil n'est pas en
  mode DIY et sa clé manque. Connectez le cloud une fois, ou ajoutez la clé à
  la main.
- **« Connecté ailleurs »** : un autre programme utilise le même App ID avec
  votre compte. Utilisez votre propre application développeur.
- **Quota épuisé** : le réseau local continue de fonctionner ; le cloud revient
  le 1er du mois.
- **Mesures de puissance figées** : depuis 2026, eWeLink ne relaie plus la
  puissance, l'intensité et la tension par le cloud : ces appareils ont besoin
  du réseau local.
- Plus de détails : ouvrez l'onglet **Journaux** de l'intégration ; chaque
  recherche, commande et évènement du cloud y est inscrit.
