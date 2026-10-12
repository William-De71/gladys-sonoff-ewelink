# Sonoff / eWeLink

Controle sus dispositivos Sonoff y eWeLink desde Gladys, primero a través de
su red local, con la nube de eWeLink como respaldo opcional. Los dispositivos
siguen funcionando sin internet, y la nube completa lo que falta (claves de
cifrado, dispositivos Zigbee de una pasarela, control remoto).

![Ilustración de los widgets de red y energía Sonoff, no es una captura de pantalla](https://raw.githubusercontent.com/William-De71/gladys-sonoff-ewelink/main/docs/assets/widgets-illustration.svg)

Esta integración no está afiliada a ITEAD (Sonoff) ni a CoolKit (eWeLink).

## Presentación

- **Primero la red local**: Gladys encuentra los dispositivos en la red (mDNS)
  y la integración les envía los comandos directamente, cifrados como lo hace
  la app eWeLink. Los dispositivos en **modo DIY** no necesitan nada más.
- **La nube de eWeLink, opcional**: con su propia aplicación de desarrollador
  eWeLink, gratuita, la integración obtiene los nombres y las claves de cifrado
  de sus dispositivos, las actualizaciones en tiempo real, un respaldo cuando
  falla la red local y los dispositivos Zigbee de una pasarela.
- Cada dispositivo muestra una insignia **Local / Nube / Inaccesible**, con un
  punto naranja cuando funciona en modo degradado (visto en local pero
  controlado por la nube).

### Dispositivos compatibles

Más de 110 modelos eWeLink, adaptados del proyecto SonoffLAN: interruptores de
uno o varios canales (Basic, Mini, Micro, T1, TX Ultimate, M5), enchufes y
módulos con medición (POW, POWR2, POWR3, S40, S60, DualR3, SPM-4Relay),
termostatos TH, iluminación (D1, B02, B05, L1, L3, bombillas Zigbee),
ventiladores iFan, cortinas y puertas de garaje, sensores Wi-Fi y Zigbee
(apertura, movimiento, presencia, fugas, temperatura, humedad, calidad del
aire), válvula termostática TRVZB, NSPanel, sirena SNZB-09P, válvulas de agua
y el RF Bridge 433.

## Requisitos previos

- Gladys Assistant **5.2.0** o posterior.
- Dispositivos con el firmware eWeLink original (o en modo DIY), en la misma
  red que el servidor Gladys: el mDNS debe llegar a él (sin aislamiento por
  VLAN ni aislamiento de clientes en el Wi-Fi).
- Los dispositivos que no están en modo DIY cifran sus mensajes con una clave
  que solo conoce la nube de eWeLink. Para controlarlos en local, conecte la
  nube una vez (las claves se conservan después) o añada cada clave a mano.
- Para la nube: una cuenta gratuita en el centro de desarrolladores de eWeLink
  ([dev.ewelink.cc](https://dev.ewelink.cc)) y una aplicación. Su cuota
  gratuita es de 50.000 llamadas a la API al mes y por región: el WebSocket en
  tiempo real casi no consume.

## Configuración

### Red local

El **control por la red local** está activo por defecto. El **intervalo de
búsqueda en la red** (60 s) fija con qué frecuencia se buscan direcciones y
estados; el **intervalo de actualización local** (30 s), con qué frecuencia se
consulta el estado de cada dispositivo (potencia, temperatura...).

### Nube eWeLink (opcional)

1. Inicie sesión en [dev.ewelink.cc](https://dev.ewelink.cc), complete la
   certificación de desarrollador y cree una aplicación.
2. En Gladys, elija la conexión a la nube **Aplicación de desarrollador
   (OAuth)**, introduzca el **App ID**, el **App Secret** y la **región** de su
   cuenta, y **guarde**.
3. Copie la **URI de redirección** que aparece junto al botón **Conectar** en
   la aplicación del centro de desarrolladores de eWeLink.
4. Haga clic en **Conectar** e inicie sesión con su cuenta eWeLink. La insignia
   de la integración pasa a «Conectado».

El modo **Correo electrónico y contraseña** solo funciona con un App ID
autorizado a iniciar sesión con contraseña, lo que no son los App ID de
desarrollador gratuitos. Iniciar sesión con el App ID de otra aplicación puede
desconectarla.

### Añadir un dispositivo a mano

La acción **Añadir un dispositivo a mano** pide el ID del dispositivo (10
caracteres, visible en la app eWeLink) y, opcionalmente, su dirección IP y su
clave. Úsela para un dispositivo que la búsqueda en la red no ve, o para
controlar un dispositivo en local sin la nube si conoce su clave.

### Preferir la conexión local

Gladys muestra el interruptor estándar **Preferir la conexión local (LAN)
cuando esté disponible**. Activado, los comandos pasan por la red local y
recurren a la nube; desactivado, la nube va primero.

## Uso

### Descubrimiento y creación

Abra la pestaña **Descubrir** e inicie una búsqueda: aparecen los dispositivos
encontrados en la red y en su cuenta eWeLink, con su nombre y sus funciones.
Cree los que quiera: aparecen en la pestaña **Dispositivos** y en sus paneles.

### Disparadores de escena

- **Botón Sonoff pulsado**: un botón inalámbrico, un mando o un interruptor de
  pared notificó una pulsación. Filtre por dispositivo, botón (1 a 4) y
  pulsación (simple, doble, larga, triple). Variables: `button`, `press`,
  `device_name`.
- **Código RF recibido**: un RF Bridge recibió un código aprendido (mando,
  sensor de apertura o de movimiento). Variables: `channel`, `name`,
  `device_name`.
- **Dispositivo Sonoff conectado/desconectado**: un dispositivo deja de ser
  accesible, o vuelve a serlo. Variables: `status`, `device_name`.
- **Estado de la nube eWeLink cambiado**: conexión perdida, recuperada, inicio
  de sesión necesario o cuota agotada. Variable: `status`.

### Acciones de escena

- **Enviar un código RF**: un RF Bridge envía un código aprendido (número o
  nombre). Salidas: `sent`, `via`.
- **Enviar un comando eWeLink**: parámetros eWeLink en bruto en JSON, para lo
  que Gladys no controla (efectos de luz...). Salidas: `sent`, `via`.
- **Volver a buscar dispositivos Sonoff**: salidas `devices` y `reachable`.

### Widgets del panel

- **Red Sonoff**: dispositivos accesibles en local, por la nube o
  inaccesibles, sesión en la nube, llamadas a la API del mes, dispositivos a
  revisar y un botón **Volver a buscar**.
- **Energía Sonoff**: potencia, tensión, corriente y consumo de un dispositivo
  con medición, su potencia en 24 horas y botones Encender / Apagar.
- **Mando RF**: hasta cuatro códigos de un RF Bridge como botones, y los
  últimos códigos recibidos.

### Ejemplos de escenas

- Cuando el **botón de la mesilla** recibe una doble pulsación, apagar todas
  las luces de la casa.
- Cuando el RF Bridge recibe el código de la **puerta de entrada** por la
  noche, encender el recibidor y enviar un mensaje.
- Cuando el **enchufe del congelador** deja de ser accesible, enviar una
  notificación con `{{triggerEvent.data.device_name}}`.

## Solución de problemas

- **No se encuentra ningún dispositivo**: el servidor Gladys y los
  dispositivos deben estar en la misma red, con el mDNS permitido. Ejecute la
  acción **Probar la conexión**: indica cuántos dispositivos responden en la
  red local.
- **Insignia naranja «visto en la red, clave desconocida»**: el dispositivo no
  está en modo DIY y falta su clave. Conecte la nube una vez o añada la clave a
  mano.
- **«Sesión iniciada en otro lugar»**: otro programa usa el mismo App ID con su
  cuenta. Use su propia aplicación de desarrollador.
- **Cuota agotada**: la red local sigue funcionando; la nube vuelve el día 1
  del mes.
- **Medidas de potencia congeladas**: desde 2026, eWeLink ya no transmite la
  potencia, la corriente ni la tensión por la nube: estos dispositivos
  necesitan la red local.
- Más detalles: abra la pestaña **Registros** de la integración; cada
  búsqueda, comando y evento de la nube queda anotado allí.
