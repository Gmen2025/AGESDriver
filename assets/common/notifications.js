import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";

import baseUrl from "./baseUrl";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const setupAndroidChannel = async () => {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      sound: "default",
    });
  }
};

const getProjectId = () =>
  Constants?.expoConfig?.extra?.eas?.projectId || Constants?.easConfig?.projectId || null;

export const registerDriverPushToken = async (driverId, authToken) => {
  if (!driverId || !authToken || !Device.isDevice) {
    return { ok: false, message: "Driver ID, authentication, and a physical device are required" };
  }

  if (Constants?.appOwnership === "expo") {
    return { ok: false, message: "Remote push notifications require a development build" };
  }

  await setupAndroidChannel();
  const permission = await Notifications.getPermissionsAsync();
  const finalStatus = permission.status === "granted"
    ? permission.status
    : (await Notifications.requestPermissionsAsync()).status;

  if (finalStatus !== "granted") {
    return { ok: false, message: "Notification permission not granted" };
  }

  const projectId = getProjectId();
  if (!projectId) {
    return { ok: false, message: "Missing EAS projectId in driver app config" };
  }

  const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
  const response = await fetch(`${baseUrl}notifications/drivers/${driverId}/push-token`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ pushToken: token }),
  });

  if (!response.ok) {
    throw new Error((await response.text()) || `Push token registration failed (${response.status})`);
  }

  await AsyncStorage.setItem("driver_push_token", token);
  return { ok: true, pushToken: token };
};

export const addDriverNotificationListener = (listener) =>
  Notifications.addNotificationReceivedListener(listener);

export const addDriverNotificationResponseListener = (listener) =>
  Notifications.addNotificationResponseReceivedListener(listener);

export const removeDriverNotificationListener = (subscription) => {
  if (subscription?.remove) {
    subscription.remove();
  }
};
