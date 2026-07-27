import { io } from "socket.io-client";
import { api } from "./api.js";

let socket = null;

export function connectRealtime({ role, clientId }) {
  if (socket) socket.disconnect();
  socket = io(api.apiUrl, { transports: ["websocket"] });
  socket.on("connect", () => socket.emit("join", { role, clientId }));
  return socket;
}

export function onRealtime(event, handler) {
  if (!socket) return () => {};
  socket.on(event, handler);
  return () => socket.off(event, handler);
}

export function disconnectRealtime() {
  if (socket) socket.disconnect();
  socket = null;
}
