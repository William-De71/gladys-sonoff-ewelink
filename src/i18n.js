// -----------------------------------------------------------------------------
// Runtime messages shown to the user (connection status, action results,
// widget texts, transport badges, errors), in the four languages of the
// Gladys interface. `en` is the fallback. test/i18n.test.js checks that every
// message has the four languages and the same placeholders.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const MESSAGES = {
  // --- Connection status ----------------------------------------------------
  cloudAppMissing: {
    en: 'Enter the App ID and App Secret of your eWeLink developer application.',
    fr: "Saisissez l'App ID et l'App Secret de votre application développeur eWeLink.",
    de: 'Geben Sie die App ID und das App Secret Ihrer eWeLink-Entwickleranwendung ein.',
    es: 'Introduzca el App ID y el App Secret de su aplicación de desarrollador eWeLink.',
  },
  cloudNotLinked: {
    en: 'Click Connect to link your eWeLink account.',
    fr: 'Cliquez sur Connecter pour lier votre compte eWeLink.',
    de: 'Klicken Sie auf Verbinden, um Ihr eWeLink-Konto zu verknüpfen.',
    es: 'Haga clic en Conectar para vincular su cuenta eWeLink.',
  },
  cloudSessionExpired: {
    en: 'The eWeLink session expired: click Connect again.',
    fr: 'La session eWeLink a expiré : cliquez de nouveau sur Connecter.',
    de: 'Die eWeLink-Sitzung ist abgelaufen: Klicken Sie erneut auf Verbinden.',
    es: 'La sesión de eWeLink ha caducado: vuelva a hacer clic en Conectar.',
  },
  cloudLoginFailed: {
    en: 'eWeLink sign-in failed: {reason}',
    fr: 'Échec de la connexion à eWeLink : {reason}',
    de: 'Anmeldung bei eWeLink fehlgeschlagen: {reason}',
    es: 'Error al iniciar sesión en eWeLink: {reason}',
  },
  cloudQuotaExhausted: {
    en: 'The monthly API quota of your eWeLink App ID is exhausted: local control only.',
    fr: "Le quota mensuel d'API de votre App ID eWeLink est épuisé : contrôle local uniquement.",
    de: 'Das monatliche API-Kontingent Ihrer eWeLink App ID ist aufgebraucht: nur lokale Steuerung.',
    es: 'Se agotó la cuota mensual de API de su App ID de eWeLink: solo control local.',
  },
  cloudSignedInElsewhere: {
    en: 'eWeLink refused the session (signed in elsewhere with the same App ID?).',
    fr: 'eWeLink a refusé la session (connecté ailleurs avec le même App ID ?).',
    de: 'eWeLink hat die Sitzung abgelehnt (anderswo mit derselben App ID angemeldet?).',
    es: 'eWeLink rechazó la sesión (¿sesión iniciada en otro lugar con el mismo App ID?).',
  },
  cloudUnreachable: {
    en: 'eWeLink cloud unreachable, retrying: local control still works.',
    fr: 'Cloud eWeLink injoignable, nouvelle tentative : le contrôle local fonctionne toujours.',
    de: 'eWeLink-Cloud nicht erreichbar, neuer Versuch: die lokale Steuerung funktioniert weiter.',
    es: 'Nube de eWeLink inaccesible, reintentando: el control local sigue funcionando.',
  },
  oauthStateMismatch: {
    en: 'The eWeLink authorization does not match the request: click Connect again.',
    fr: "L'autorisation eWeLink ne correspond pas à la demande : cliquez de nouveau sur Connecter.",
    de: 'Die eWeLink-Autorisierung passt nicht zur Anfrage: Klicken Sie erneut auf Verbinden.',
    es: 'La autorización de eWeLink no coincide con la solicitud: vuelva a hacer clic en Conectar.',
  },
  oauthWrongMode: {
    en: 'Choose the "Developer application (OAuth)" cloud mode and save before connecting.',
    fr: 'Choisissez le mode cloud « Application développeur (OAuth) » et enregistrez avant de vous connecter.',
    de: 'Wählen Sie den Cloud-Modus „Entwickleranwendung (OAuth)“ und speichern Sie vor dem Verbinden.',
    es: 'Elija el modo de nube «Aplicación de desarrollador (OAuth)» y guarde antes de conectar.',
  },
  initFailed: {
    en: 'Initialization failed, check the integration logs.',
    fr: "L'initialisation a échoué, consultez les journaux de l'intégration.",
    de: 'Die Initialisierung ist fehlgeschlagen, prüfen Sie die Protokolle der Integration.',
    es: 'La inicialización falló, consulte los registros de la integración.',
  },

  // --- Transport badges -----------------------------------------------------
  transportKeyMissing: {
    en: 'Seen on the network, but its encryption key is unknown: cloud in use.',
    fr: 'Vu sur le réseau, mais sa clé de chiffrement est inconnue : cloud utilisé.',
    de: 'Im Netzwerk gesehen, aber sein Schlüssel ist unbekannt: Cloud wird genutzt.',
    es: 'Visto en la red, pero su clave de cifrado es desconocida: se usa la nube.',
  },
  transportLocalLost: {
    en: 'Not answering on the local network: cloud in use.',
    fr: 'Ne répond pas sur le réseau local : cloud utilisé.',
    de: 'Antwortet nicht im lokalen Netzwerk: Cloud wird genutzt.',
    es: 'No responde en la red local: se usa la nube.',
  },

  // --- Manifest actions -----------------------------------------------------
  invalidDeviceId: {
    en: 'The device ID must be the 10 characters shown in the eWeLink app (e.g. 1000a1b2c3).',
    fr: "L'ID d'appareil doit faire les 10 caractères affichés dans l'app eWeLink (ex. 1000a1b2c3).",
    de: 'Die Geräte-ID muss aus den 10 Zeichen der eWeLink-App bestehen (z. B. 1000a1b2c3).',
    es: 'El ID del dispositivo debe tener los 10 caracteres de la app eWeLink (p. ej. 1000a1b2c3).',
  },
  invalidHost: {
    en: 'The IP address is not valid (e.g. 192.168.1.42 or 192.168.1.42:8081).',
    fr: "L'adresse IP n'est pas valide (ex. 192.168.1.42 ou 192.168.1.42:8081).",
    de: 'Die IP-Adresse ist ungültig (z. B. 192.168.1.42 oder 192.168.1.42:8081).',
    es: 'La dirección IP no es válida (p. ej. 192.168.1.42 o 192.168.1.42:8081).',
  },
  localDeviceSaved: {
    en: 'Device {deviceid} saved. Run a scan in the Discover tab.',
    fr: "Appareil {deviceid} enregistré. Lancez une recherche dans l'onglet Découverte.",
    de: 'Gerät {deviceid} gespeichert. Starten Sie eine Suche im Tab Entdecken.',
    es: 'Dispositivo {deviceid} guardado. Inicie una búsqueda en la pestaña Descubrir.',
  },
  localDeviceRemoved: {
    en: 'Device {deviceid} removed from the manual list.',
    fr: 'Appareil {deviceid} retiré de la liste manuelle.',
    de: 'Gerät {deviceid} aus der manuellen Liste entfernt.',
    es: 'Dispositivo {deviceid} eliminado de la lista manual.',
  },
  localDeviceUnknown: {
    en: 'No device {deviceid} in the manual list.',
    fr: 'Aucun appareil {deviceid} dans la liste manuelle.',
    de: 'Kein Gerät {deviceid} in der manuellen Liste.',
    es: 'Ningún dispositivo {deviceid} en la lista manual.',
  },
  testResult: {
    en: 'Local network: {local} device(s) found. Cloud: {cloud}. Devices known: {total}.',
    fr: 'Réseau local : {local} appareil(s) trouvé(s). Cloud : {cloud}. Appareils connus : {total}.',
    de: 'Lokales Netzwerk: {local} Gerät(e) gefunden. Cloud: {cloud}. Bekannte Geräte: {total}.',
    es: 'Red local: {local} dispositivo(s) encontrado(s). Nube: {cloud}. Dispositivos conocidos: {total}.',
  },
  cloudConnected: {
    en: 'connected ({count} device(s))',
    fr: 'connecté ({count} appareil(s))',
    de: 'verbunden ({count} Gerät(e))',
    es: 'conectada ({count} dispositivo(s))',
  },
  cloudDisconnected: {
    en: 'not connected',
    fr: 'non connecté',
    de: 'nicht verbunden',
    es: 'no conectada',
  },
  cloudDisabled: {
    en: 'disabled',
    fr: 'désactivé',
    de: 'deaktiviert',
    es: 'desactivada',
  },
  scanUnavailable: {
    en: 'The local scan is unavailable ({reason}).',
    fr: "La recherche locale n'est pas disponible ({reason}).",
    de: 'Die lokale Suche ist nicht verfügbar ({reason}).',
    es: 'La búsqueda local no está disponible ({reason}).',
  },

  // --- Commands and scene actions -------------------------------------------
  deviceUnknown: {
    en: 'Unknown Sonoff device, run a scan first.',
    fr: "Appareil Sonoff inconnu, lancez d'abord une recherche.",
    de: 'Unbekanntes Sonoff-Gerät, starten Sie zuerst eine Suche.',
    es: 'Dispositivo Sonoff desconocido, inicie primero una búsqueda.',
  },
  deviceUnreachable: {
    en: 'The device is unreachable (local network and cloud).',
    fr: "L'appareil est injoignable (réseau local et cloud).",
    de: 'Das Gerät ist nicht erreichbar (lokales Netzwerk und Cloud).',
    es: 'El dispositivo es inaccesible (red local y nube).',
  },
  commandRefused: {
    en: 'The device refused the command ({result}).',
    fr: "L'appareil a refusé la commande ({result}).",
    de: 'Das Gerät hat den Befehl abgelehnt ({result}).',
    es: 'El dispositivo rechazó el comando ({result}).',
  },
  invalidJson: {
    en: 'The parameters must be a JSON object, e.g. {"switch":"on"}.',
    fr: 'Les paramètres doivent être un objet JSON, ex. {"switch":"on"}.',
    de: 'Die Parameter müssen ein JSON-Objekt sein, z. B. {"switch":"on"}.',
    es: 'Los parámetros deben ser un objeto JSON, p. ej. {"switch":"on"}.',
  },
  notRfBridge: {
    en: 'This device is not an RF Bridge or has no code {channel}.',
    fr: "Cet appareil n'est pas un RF Bridge ou n'a pas de code {channel}.",
    de: 'Dieses Gerät ist keine RF Bridge oder hat keinen Code {channel}.',
    es: 'Este dispositivo no es un RF Bridge o no tiene el código {channel}.',
  },
  scanDone: {
    en: '{count} device(s) found.',
    fr: '{count} appareil(s) trouvé(s).',
    de: '{count} Gerät(e) gefunden.',
    es: '{count} dispositivo(s) encontrado(s).',
  },

  // --- Widgets --------------------------------------------------------------
  wCloud: { en: 'eWeLink cloud', fr: 'Cloud eWeLink', de: 'eWeLink-Cloud', es: 'Nube eWeLink' },
  wConnected: { en: 'Connected', fr: 'Connecté', de: 'Verbunden', es: 'Conectada' },
  wDisconnected: { en: 'Disconnected', fr: 'Déconnecté', de: 'Getrennt', es: 'Desconectada' },
  wDisabled: { en: 'Disabled', fr: 'Désactivé', de: 'Deaktiviert', es: 'Desactivada' },
  wLocalScan: {
    en: 'Local network',
    fr: 'Réseau local',
    de: 'Lokales Netzwerk',
    es: 'Red local',
  },
  wLocalOn: { en: 'Active', fr: 'Actif', de: 'Aktiv', es: 'Activa' },
  wApiCalls: {
    en: 'API calls this month',
    fr: "Appels d'API ce mois-ci",
    de: 'API-Aufrufe diesen Monat',
    es: 'Llamadas a la API este mes',
  },
  wLocal: { en: 'Local', fr: 'Local', de: 'Lokal', es: 'Local' },
  wCloudShort: { en: 'Cloud', fr: 'Cloud', de: 'Cloud', es: 'Nube' },
  wOffline: { en: 'Offline', fr: 'Hors ligne', de: 'Offline', es: 'Sin conexión' },
  wAllReachable: {
    en: 'All {count} device(s) are reachable.',
    fr: 'Les {count} appareil(s) sont joignables.',
    de: 'Alle {count} Gerät(e) sind erreichbar.',
    es: 'Los {count} dispositivo(s) son accesibles.',
  },
  wNoDevice: {
    en: 'No Sonoff device yet: run a scan in the Discover tab.',
    fr: "Aucun appareil Sonoff pour l'instant : lancez une recherche dans l'onglet Découverte.",
    de: 'Noch kein Sonoff-Gerät: Starten Sie eine Suche im Tab Entdecken.',
    es: 'Aún no hay dispositivos Sonoff: inicie una búsqueda en la pestaña Descubrir.',
  },
  wRescan: { en: 'Rescan', fr: 'Relancer', de: 'Neu suchen', es: 'Volver a buscar' },
  wUnreachable: { en: 'Unreachable', fr: 'Injoignable', de: 'Nicht erreichbar', es: 'Inaccesible' },
  wDegraded: { en: 'Degraded', fr: 'Dégradé', de: 'Beeinträchtigt', es: 'Degradado' },
  wPickDevice: {
    en: 'Choose a device in the widget settings.',
    fr: 'Choisissez un appareil dans les réglages du widget.',
    de: 'Wählen Sie ein Gerät in den Widget-Einstellungen.',
    es: 'Elija un dispositivo en los ajustes del widget.',
  },
  wNoMetering: {
    en: 'This device does not measure its consumption.',
    fr: 'Cet appareil ne mesure pas sa consommation.',
    de: 'Dieses Gerät misst seinen Verbrauch nicht.',
    es: 'Este dispositivo no mide su consumo.',
  },
  wPower: { en: 'Power', fr: 'Puissance', de: 'Leistung', es: 'Potencia' },
  wVoltage: { en: 'Voltage', fr: 'Tension', de: 'Spannung', es: 'Tensión' },
  wCurrent: { en: 'Current', fr: 'Intensité', de: 'Strom', es: 'Corriente' },
  wToday: { en: 'Today', fr: "Aujourd'hui", de: 'Heute', es: 'Hoy' },
  wMonth: { en: 'This month', fr: 'Ce mois-ci', de: 'Diesen Monat', es: 'Este mes' },
  wPowerChart: {
    en: 'Power, last 24 hours',
    fr: 'Puissance, dernières 24 heures',
    de: 'Leistung, letzte 24 Stunden',
    es: 'Potencia, últimas 24 horas',
  },
  wOn: { en: 'On', fr: 'Allumer', de: 'Ein', es: 'Encender' },
  wOff: { en: 'Off', fr: 'Éteindre', de: 'Aus', es: 'Apagar' },
  wNotRfBridge: {
    en: 'This device is not an RF Bridge.',
    fr: "Cet appareil n'est pas un RF Bridge.",
    de: 'Dieses Gerät ist keine RF Bridge.',
    es: 'Este dispositivo no es un RF Bridge.',
  },
  wNoRfCode: {
    en: 'No code learned yet: learn them in the eWeLink app.',
    fr: "Aucun code appris : apprenez-les dans l'app eWeLink.",
    de: 'Noch kein Code angelernt: Lernen Sie sie in der eWeLink-App an.',
    es: 'Aún no hay códigos aprendidos: apréndalos en la app eWeLink.',
  },
  wNothingReceived: {
    en: 'No code received since the integration started.',
    fr: "Aucun code reçu depuis le démarrage de l'intégration.",
    de: 'Seit dem Start der Integration wurde kein Code empfangen.',
    es: 'No se ha recibido ningún código desde el inicio de la integración.',
  },
};

/**
 * A message in the four languages, placeholders replaced.
 * @param {keyof MESSAGES} key - Message key.
 * @param {Record<string, string | number>} [vars] - Values of the `{name}` placeholders.
 * @returns {Record<string, string>} `{ en, fr, de, es }`.
 */
export function t(key, vars = {}) {
  const message = MESSAGES[key];
  if (!message) {
    throw new Error(`Unknown message "${key}"`);
  }
  return Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      message[language].replace(/\{(\w+)\}/g, (match, name) =>
        name in vars ? String(vars[name]) : match,
      ),
    ]),
  );
}

/** Same message with a per-language variable (an already translated word). */
export function tWith(key, vars, translated) {
  const base = MESSAGES[key];
  return Object.fromEntries(
    LANGUAGES.map((language) => {
      const values = { ...vars };
      for (const [name, value] of Object.entries(translated)) {
        values[name] = value[language];
      }
      return [
        language,
        base[language].replace(/\{(\w+)\}/g, (match, name) =>
          name in values ? String(values[name]) : match,
        ),
      ];
    }),
  );
}
