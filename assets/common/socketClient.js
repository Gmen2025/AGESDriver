import { io } from "socket.io-client";
import Constants from "expo-constants";

let socketInstance = null;
let socketPromise = null;

const getSocketConfig = () => ({
  deliveryEvent: process.env.EXPO_PUBLIC_SOCKET_DELIVERY_EVENT || "new_delivery_request",
  registerEvent: process.env.EXPO_PUBLIC_SOCKET_REGISTER_EVENT || "driver_register",
  acceptEvent: process.env.EXPO_PUBLIC_SOCKET_ACCEPT_EVENT || "order_accepted",
  rejectEvent: process.env.EXPO_PUBLIC_SOCKET_REJECT_EVENT || "order_rejected",
  statusEvent: process.env.EXPO_PUBLIC_SOCKET_STATUS_EVENT || "order_status_updated",
  driverRegisteredEvent: process.env.EXPO_PUBLIC_SOCKET_REGISTERED_EVENT || "driver_registered",
});

const normalizeSocketUrl = (value) => {
  if (typeof value !== "string") {
    return "";
  }

  let normalized = value.trim();
  if (!normalized) {
    return "";
  }

  normalized = normalized.replace(/\/+$/, "");

  if (/^wss?:\/\//i.test(normalized)) {
    return normalized;
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  if (!/^https?:\/\//i.test(normalized) && !/^wss?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  if (/\/api\/v1$/i.test(normalized)) {
    return normalized.replace(/\/api\/v1$/i, "");
  }

  if (/\/api$/i.test(normalized)) {
    return normalized.replace(/\/api$/i, "");
  }

  return normalized;
};

const getSocketUrl = () => {
  const configUrl = Constants?.expoConfig?.extra?.socketUrl;
  const envUrl = process.env.EXPO_PUBLIC_SOCKET_URL;
  const candidate = typeof configUrl === "string" && configUrl.trim()
    ? configUrl
    : typeof envUrl === "string"
      ? envUrl
      : "";

  const normalized = normalizeSocketUrl(candidate);
  return normalized || "https://easy-shop-server-wldr.onrender.com";
};

export const getSocketConnectionStatus = () => {
  const socketUrl = getSocketUrl();
  return {
    socketUrl,
    configured: Boolean(socketUrl),
  };
};

export const getDriverSocket = (authToken) => {
  if (socketInstance) {
    return Promise.resolve(socketInstance);
  }

  if (socketPromise) {
    return socketPromise;
  }

  const targetUrl = getSocketUrl();

  socketPromise = new Promise((resolve, reject) => {
    const instance = io(targetUrl, {
      transports: ["websocket", "polling"],
      path: "/socket.io",
      auth: authToken ? { token: authToken } : undefined,
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      timeout: 5000,
      forceNew: true,
    });

    instance.on("connect", () => {
      socketInstance = instance;
      resolve(instance);
    });

    instance.on("connect_error", (error) => {
      if (!socketInstance) {
        reject(error);
      }
    });

    instance.on("disconnect", () => {
      socketInstance = null;
    });
  });

  return socketPromise;
};

export const disconnectDriverSocket = () => {
  if (socketInstance) {
    socketInstance.disconnect();
  }
  socketInstance = null;
  socketPromise = null;
};

export const getSocketEventNames = () => getSocketConfig();

export const registerDriverSocket = async (driverIdentity = {}) => {
  const socket = await getDriverSocket(driverIdentity.authToken);
  const driverId =
    driverIdentity?.driverId ||
    process.env.EXPO_PUBLIC_DRIVER_ID ||
    "demo-driver";

  socket.emit(getSocketConfig().registerEvent, {
    driverId,
    role: "driver",
    platform: "mobile",
  });

  return socket;
};

export const emitDriverEvent = async (eventName, payload, authToken) => {
  const socket = await getDriverSocket(authToken);
  socket.emit(eventName, payload);
  return socket;
};
