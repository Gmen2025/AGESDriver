import AsyncStorage from "@react-native-async-storage/async-storage";

import baseUrl from "./baseUrl";

export const updateDeliveryStatus = async (orderId, deliveryStatus) => {
  const token = await AsyncStorage.getItem("driver_token");
  if (!orderId || !token) {
    throw new Error("Missing order ID or driver authentication");
  }

  const response = await fetch(`${baseUrl}orders/${orderId}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ deliveryStatus }),
  });

  if (!response.ok) {
    throw new Error((await response.text()) || `Delivery update failed (${response.status})`);
  }

  return response.json();
};
