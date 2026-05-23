# Chat de Prueba

Chat en tiempo real hecho desde cero con React, Node.js, Socket.IO y SQLite.

## Funciones

- Entrada rápida solo con nombre, sin correos ni registro.
- Mensajes en tiempo real con Socket.IO.
- Historial persistente en `data/chat.sqlite`.
- Lista de usuarios en línea.
- Indicador de escritura.
- Interfaz responsiva para escritorio y móvil.

## Ejecutar en desarrollo

```bash
npm install
npm run dev
```

Frontend: `http://localhost:5173`  
Backend: `http://localhost:4000`

## Ejecutar como app completa

```bash
npm install
npm run build
npm start
```

URL: `http://localhost:4000`
