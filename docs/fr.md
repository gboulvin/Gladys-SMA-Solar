# SMA Solar

Suivez votre installation solaire SMA dans Gladys : production, énergie du
jour, batterie, échanges avec le réseau et état de chaque appareil, lus
**directement sur votre réseau local** en Modbus TCP. Pas de cloud, pas de
compte Sunny Portal, pas de clé d'API : les valeurs restent chez vous et
continuent d'arriver quand Internet est coupé.

## Appareils compatibles

Tout appareil SMA qui parle le **profil Modbus SMA** en TCP, notamment :

- onduleurs photovoltaïques : Sunny Boy, Sunny Tripower (dont les séries X et
  CORE), Sunny Highpower ;
- onduleurs hybrides : Sunny Tripower Smart Energy, Sunny Boy Smart Energy ;
- onduleurs de batterie : Sunny Boy Storage, Sunny Island ;
- les appareils raccordés à un SMA Data Manager ou Cluster Controller.

Les échanges avec le réseau (puissance soutirée et injectée) apparaissent
quand un **SMA Energy Meter** ou un **Sunny Home Manager** est relié à
l'onduleur : c'est alors l'onduleur qui les transmet en Modbus.

## Prérequis

1. **Activez Modbus TCP** sur chaque appareil. Selon sa génération :
   - appareils avec interface web (WebConnect, ennexOS) : connectez-vous avec
     l'utilisateur **Installateur**, ouvrez **Paramètres de l'appareil →
     Communication externe → Modbus → Serveur TCP** et passez-le sur
     **Activé** ;
   - appareils gérés dans Sunny Portal : **Configuration → Configuration des
     appareils → Communication externe → Modbus → Serveur TCP : Activé** ;
   - avec Sunny Explorer : même paramètre, connecté en installateur.
2. Donnez à chaque appareil une **adresse IP fixe** (une réservation DHCP dans
   votre box suffit).
3. Gladys et les appareils doivent être sur le même réseau, ou le réseau doit
   laisser Gladys joindre le port TCP **502** des appareils.

> Modbus TCP n'a pas de mot de passe : gardez-le sur votre réseau local et ne
> redirigez **jamais** le port 502 sur votre box Internet.

## Configuration

1. Ouvrez l'onglet **Configuration** de l'intégration.
2. Dans **Appareils SMA**, saisissez l'adresse IP de chaque appareil,
   séparées par des virgules : `192.168.1.50, 192.168.1.51`.
   - autre port : `192.168.1.50:1502` ;
   - autre identifiant d'unité Modbus (appareils derrière un Data Manager, qui
     affiche l'identifiant de chaque appareil dans ses réglages Modbus) :
     `192.168.1.30/4` ;
   - les deux : `192.168.1.30:502/5`.
3. Le **port** (502) et l'**identifiant d'unité** (3) s'appliquent aux
   adresses qui n'en précisent pas : gardez-les sauf si vous les avez changés
   sur vos appareils.
4. **Intervalle de rafraîchissement** : fréquence de lecture des appareils,
   30 secondes par défaut (10 secondes minimum).
5. **Seuil de production** : la puissance (en W, 50 par défaut) au-dessus de
   laquelle un onduleur est considéré comme en production, pour les
   déclencheurs de scène début / fin de production.
6. Enregistrez, puis cliquez sur **Tester la connexion** : la liste des
   appareils qui ont répondu et de ceux qui n'ont pas répondu s'affiche, avec
   la raison.
7. Ouvrez l'onglet **Découverte** et ajoutez vos appareils.

## Ce que vous obtenez

Un appareil par appareil SMA, nommé d'après son numéro de série, avec les
fonctionnalités qu'il porte :

| Fonctionnalité                                                      | Appareils                |
| ------------------------------------------------------------------- | ------------------------ |
| Production solaire (W), production du jour (kWh), totale (kWh)      | onduleurs PV et hybrides |
| Niveau de batterie (%), puissance de charge / décharge (W), énergie | batterie, hybride        |
| Puissance soutirée / injectée sur le réseau (W), énergie (kWh)      | avec un Energy Meter     |
| Tension AC (V), courant AC (A), température de l'onduleur (°C)      | tous                     |

Les fonctionnalités de production et de batterie alimentent la vue
**Énergie** de Gladys. Chaque appareil affiche aussi un badge **local /
injoignable**.

Beaucoup d'onduleurs coupent leur interface réseau la nuit : l'intégration
les affiche alors comme injoignables avec une production à 0 W, et s'en
souvient pour qu'ils restent disponibles après un redémarrage de Gladys.

## Scènes

L'intégration ajoute ses propres cartes à l'éditeur de scènes (Gladys 5.1 ou
plus récent), dans la catégorie **Intégrations**.

Déclencheurs :

- **Début de production solaire** — un onduleur commence à produire (sa
  puissance dépasse le seuil de production). Variables : `power`,
  `device_name`.
- **Fin de production solaire** — il s'arrête (sous la moitié du seuil, ou
  endormi). Variable `daily_energy` : l'énergie produite aujourd'hui, en kWh
  — pour un bilan quotidien.
- **Changement d'état d'un appareil SMA** — l'état d'un appareil change : OK,
  avertissement, défaut, arrêté ou injoignable. Filtrez sur le nouvel état
  pour n'être alerté que d'un défaut. Variables : `condition`,
  `previous_condition`, `device_name`.

Lisez les variables dans les actions suivantes avec
`{{triggerEvent.data.<variable>}}`, par exemple « Production du jour :
{{triggerEvent.data.daily_energy}} kWh ».

Actions :

- **Lire un appareil SMA** — lit l'appareil choisi immédiatement et donne ses
  valeurs aux actions suivantes : `reachable`, `condition`, `power`,
  `daily_energy`, `battery_level`, `grid_import_power`, `grid_export_power`.
- **Lire l'installation solaire** — lit tous les appareils et donne les
  totaux : `power`, `daily_energy`, `battery_level` (moyenne),
  `grid_import_power`, `grid_export_power`, `reachable_devices`.

Exemple : tous les jours à 13 h, lire l'installation, et si `power` dépasse
2000 W, démarrer le chauffe-eau.

## Tableau de bord

Deux widgets sont disponibles :

- **Installation solaire** — production actuelle, énergie du jour, échanges
  avec le réseau, niveau de batterie, graphique de la production du jour et
  état de chaque appareil, avec un bouton **Actualiser**.
- **Appareil SMA** — choisissez un appareil dans les réglages du widget : ses
  valeurs en direct, son état, son adresse, sa dernière lecture, sa
  température et la fréquence du réseau.

## Dépannage

- **« connect ECONNREFUSED »** : Modbus TCP n'est pas activé sur l'appareil,
  ou utilise un autre port.
- **« connect EHOSTUNREACH » / délai dépassé** : mauvaise adresse IP,
  appareil éteint ou endormi (normal la nuit pour beaucoup d'onduleurs), ou
  un pare-feu entre les deux.
- **« No SMA serial number at this address »** : l'appareil répond, mais pas
  avec cet identifiant d'unité : vérifiez-le (3 pour un onduleur interrogé
  directement, voir les réglages Modbus du Data Manager sinon).
- **Un appareil apparaît deux fois** : il est listé sous deux adresses ;
  gardez-en une.
- Les logs de l'intégration sont dans l'interface de Gladys (ou
  `docker logs`) ; démarrez l'intégration avec `LOG_LEVEL=debug` pour le
  détail complet.
