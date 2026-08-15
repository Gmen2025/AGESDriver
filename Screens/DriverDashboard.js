import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import { Audio } from "expo-av";
import * as Haptics from "expo-haptics";
import { Linking } from "react-native";

import DeliveryRequestModal from "../Shared/DeliveryRequestModal";
import {
  disconnectDriverSocket,
  emitDriverEvent,
  getDriverSocket,
  getSocketEventNames,
  registerDriverSocket,
} from "../assets/common/socketClient";
import { useAuth } from "../Context/store/Auth";

const DEFAULT_DRIVER_COORDINATES = {
  latitude: 8.9806,
  longitude: 38.7578,
};

// The customer-facing easy_shopping app owns route navigation/tracking during a delivery.
const openEasyShoppingRoute = async (orderStatus, request) => {
  const url = `addugeneteshop://delivery-route/${orderStatus}?request=${encodeURIComponent(
    JSON.stringify(request)
  )}`;
  try {
    await Linking.openURL(url);
  } catch (error) {
    console.warn("Unable to open easy_shopping app for route navigation:", error);
  }
};

const DriverDashboard = () => {
  const navigation = useNavigation();
  const route = useRoute();
  const { logout, user } = useAuth();
  const [socketConnected, setSocketConnected] = useState(false);
  const [activeRequest, setActiveRequest] = useState(null);
  const [countdown, setCountdown] = useState(30);
  const [statusText, setStatusText] = useState("Preparing dispatcher connection...");
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isAlertPlaying, setIsAlertPlaying] = useState(false);
  const [completedDelivery, setCompletedDelivery] = useState(null);
  const [pendingDeliveries, setPendingDeliveries] = useState([]);
  const soundRef = useRef(null);
  const timerRef = useRef(null);
  const mountedRef = useRef(true);

  const stopAlert = useCallback(async () => {
    try {
      if (soundRef.current) {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      }
    } catch (error) {
      console.warn("Unable to stop alert sound:", error);
    } finally {
      soundRef.current = null;
      setIsAlertPlaying(false);
    }
  }, []);

  const playAlert = useCallback(async () => {
    if (isAlertPlaying) {
      return;
    }

    try {
      await Audio.setAudioModeAsync({
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        shouldDuckAndroid: true,
      });

      const { sound } = await Audio.Sound.createAsync(
        { uri: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3" },
        { shouldPlay: true, isLooping: true }
      );
      soundRef.current = sound;
      setIsAlertPlaying(true);
    } catch (error) {
      console.warn("Unable to start alert sound:", error);
    }
  }, [isAlertPlaying]);

  const resetRequestState = useCallback(async () => {
    await stopAlert();
    setActiveRequest(null);
    setCountdown(30);
    setStatusText("Listening for the next delivery request");
  }, [stopAlert]);

  const handleOpenPendingDelivery = useCallback((request) => {
    openEasyShoppingRoute("Picked Up", {
      ...request,
      driverCoordinates: request.driverCoordinates || DEFAULT_DRIVER_COORDINATES,
    });
  }, []);

  const handleReject = useCallback(async (expired = false) => {
    if (!activeRequest) {
      return;
    }

    const payload = {
      orderId: activeRequest.id,
      reason: expired ? "timed_out" : "rejected",
      rejectedAt: new Date().toISOString(),
    };

    try {
      const { rejectEvent } = getSocketEventNames();
      await emitDriverEvent(rejectEvent, payload);
    } catch (error) {
      console.warn("Unable to emit rejection event:", error);
    }

    await resetRequestState();
  }, [activeRequest, resetRequestState]);

  const handleAccept = useCallback(async () => {
    if (!activeRequest) {
      return;
    }

    setIsTransitioning(true);
    try {
      const { acceptEvent } = getSocketEventNames();
      await emitDriverEvent(acceptEvent, {
        orderId: activeRequest.id,
        acceptedAt: new Date().toISOString(),
      });
    } catch (error) {
      console.warn("Unable to emit accept event:", error);
    }

    const request = {
      ...activeRequest,
      driverCoordinates: activeRequest.driverCoordinates || DEFAULT_DRIVER_COORDINATES,
    };

    await resetRequestState();
    await openEasyShoppingRoute("Driver Assigned", request);
    setIsTransitioning(false);
  }, [activeRequest, resetRequestState]);

  useEffect(() => {
    mountedRef.current = true;
    let socketRef = null;

    const attachSocketListeners = async () => {
      try {
        const socket = await getDriverSocket();
        if (!mountedRef.current) {
          return;
        }

        socketRef = socket;
        setSocketConnected(true);
        setStatusText("Connected to dispatcher. Waiting for requests...");

        const { deliveryEvent, statusEvent } = getSocketEventNames();
        registerDriverSocket({
          driverId: user?._id || process.env.EXPO_PUBLIC_DRIVER_ID || "demo-driver",
        });

        const handleIncomingRequest = (payload) => {
          const normalizedRequest = {
            id: payload?.id || payload?.orderId || `delivery-${Date.now()}`,
            pickupStoreName: payload?.pickupStoreName || payload?.store?.name || "North Hub Store",
            totalDistance: payload?.totalDistance || "4.8 km",
            payout: payload?.payout || "ETB 220",
            customerName: payload?.customerName || payload?.customer?.name || "Customer",
            customerLocation: payload?.customerLocation || payload?.customer?.location || {
              latitude: 8.9834,
              longitude: 38.7761,
            },
            storeLocation: payload?.storeLocation || payload?.store?.location || {
              latitude: 8.9851,
              longitude: 38.7642,
            },
            driverCoordinates: payload?.driverCoordinates || DEFAULT_DRIVER_COORDINATES,
            rawPayload: payload,
          };

          setActiveRequest(normalizedRequest);
          setCountdown(30);
          setStatusText(`Incoming request from ${normalizedRequest.pickupStoreName}`);
          playAlert();
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        };

        const handleDriverAssigned = (payload) => {
          const normalizedRequest = {
            id: payload?.orderId || payload?.id || `delivery-${Date.now()}`,
            pickupStoreName: payload?.pickupStoreName || payload?.store?.name || "North Hub Store",
            customerName: payload?.customerName || payload?.customer?.name || "Customer",
            customerLocation: payload?.customerLocation || payload?.customer?.location || {
              latitude: 8.9834,
              longitude: 38.7761,
            },
            storeLocation: payload?.storeLocation || payload?.store?.location || {
              latitude: 8.9851,
              longitude: 38.7642,
            },
            driverCoordinates: payload?.driverCoordinates || DEFAULT_DRIVER_COORDINATES,
            rawPayload: payload,
          };

          setActiveRequest(normalizedRequest);
          setCountdown(30);
          setStatusText(`Assigned to delivery ${normalizedRequest.pickupStoreName}`);
        };

        const handleConnect = () => {
          setSocketConnected(true);
          setStatusText("Connected to dispatcher. Waiting for requests...");
        };

        const handleDisconnect = () => {
          setSocketConnected(false);
          setStatusText("Socket disconnected. Reconnecting...");
        };

        socket.on(deliveryEvent, handleIncomingRequest);
        socket.on("driver_assigned", handleDriverAssigned);
        socket.on("order_assigned", handleDriverAssigned);
        socket.on(statusEvent, (payload) => {
          if (payload?.status === "accepted" || payload?.status === "rejected") {
            setStatusText(`Order ${payload.status} for ${payload.orderId || "request"}`);
          }
        });
        socket.on("connect", handleConnect);
        socket.on("disconnect", handleDisconnect);

        return () => {
          socket.off(deliveryEvent, handleIncomingRequest);
          socket.off("driver_assigned", handleDriverAssigned);
          socket.off("order_assigned", handleDriverAssigned);
          socket.off(statusEvent, () => {});
          socket.off("connect", handleConnect);
          socket.off("disconnect", handleDisconnect);
        };
      } catch (error) {
        console.warn("Socket connection failed:", error);
        setSocketConnected(false);
        setStatusText("Dispatcher unavailable. Offline mode enabled. Check your backend URL.");
      }
    };

    attachSocketListeners();

    return () => {
      mountedRef.current = false;
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      stopAlert();
      if (socketRef) {
        const { deliveryEvent } = getSocketEventNames();
        socketRef.off(deliveryEvent);
      }
      disconnectDriverSocket();
    };
  }, [playAlert, stopAlert, user?._id]);

  // Handle handoff back from easy_shopping via agesdriver://<action>?data=<json>
  useEffect(() => {
    const action = route.params?.action;
    const rawData = route.params?.data;
    if (!action || !rawData) {
      return;
    }

    let parsedData = {};
    try {
      parsedData = JSON.parse(rawData);
    } catch (error) {
      console.warn("Unable to parse handoff data:", error);
    }

    if (action === "completed-delivery" && parsedData.completedDelivery) {
      setCompletedDelivery(parsedData.completedDelivery);
      setStatusText("Delivery completed. Waiting for the next request.");
    }

    if (action === "pending-delivery" && parsedData.pendingDelivery) {
      const pendingRequest = parsedData.pendingDelivery;
      setPendingDeliveries((previous) => {
        if (previous.some((item) => item.id === pendingRequest.id)) {
          return previous;
        }
        return [...previous, { ...pendingRequest, savedAt: new Date().toISOString() }];
      });
      setStatusText("Delivery saved for later. You can resume it from the pending list.");
    }

    navigation.setParams({ action: undefined, data: undefined });
  }, [navigation, route.params?.action, route.params?.data]);

  useEffect(() => {
    if (!activeRequest) {
      return;
    }

    timerRef.current = setInterval(() => {
      setCountdown((previousValue) => {
        if (previousValue <= 1) {
          clearInterval(timerRef.current);
          timerRef.current = null;
          handleReject(true);
          return 0;
        }

        return previousValue - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [activeRequest, handleReject]);

  const simulateDemoRequest = useCallback(() => {
    const demoRequest = {
      id: `demo-${Date.now()}`,
      pickupStoreName: "City Market",
      totalDistance: "6.2 km",
      payout: "ETB 260",
      customerName: "Aster Bekele",
      customerLocation: {
        latitude: 8.9806,
        longitude: 38.7578,
      },
      storeLocation: {
        latitude: 8.9855,
        longitude: 38.7634,
      },
      driverCoordinates: DEFAULT_DRIVER_COORDINATES,
    };

    setActiveRequest(demoRequest);
    setCountdown(30);
    setStatusText("Demo request triggered");
    playAlert();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [playAlert]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.headerCard}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.title}>Delivery dispatch</Text>
              <Text style={styles.subtitle}>Driver cockpit for incoming orders</Text>
            </View>
            <TouchableOpacity onPress={logout}>
              <Text style={styles.logoutText}>Sign out</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.badgeRow}>
            <View style={[styles.badge, socketConnected && styles.badgeActive]}>
              <Text style={styles.badgeText}>{socketConnected ? "Connected" : "Connecting"}</Text>
            </View>
            <View style={[styles.badge, isAlertPlaying && styles.badgeActive]}>
              <Text style={styles.badgeText}>{isAlertPlaying ? "Alert on" : "Stand by"}</Text>
            </View>
          </View>
          <Text style={styles.statusText}>{statusText}</Text>
          {completedDelivery ? (
            <View style={styles.completedCard}>
              <Text style={styles.completedTitle}>Delivery completed</Text>
              <Text style={styles.completedText}>{completedDelivery.pickupStoreName || "Delivery"} is now marked complete.</Text>
            </View>
          ) : null}
        </View>

        {pendingDeliveries.length > 0 ? (
          <View style={styles.pendingCard}>
            <Text style={styles.pendingTitle}>Pending deliveries</Text>
            {pendingDeliveries.map((delivery) => (
              <TouchableOpacity
                key={delivery.id}
                style={styles.pendingItem}
                onPress={() => handleOpenPendingDelivery(delivery)}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.pendingItemTitle}>{delivery.pickupStoreName || "Delivery"}</Text>
                  <Text style={styles.pendingItemText}>{delivery.customerName || "Customer"}</Text>
                </View>
                <Text style={styles.pendingItemAction}>Resume</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <TouchableOpacity style={styles.primaryAction} onPress={simulateDemoRequest}>
          <Text style={styles.primaryActionText}>Simulate incoming request</Text>
        </TouchableOpacity>

        <View style={styles.centeredPanel}>
          <Text style={styles.helperText}>
            The dashboard listens for the socket event and shows a full-screen request modal when orders arrive.
            Accepting hands off navigation to the AdduGenet EShop app.
          </Text>
          {isTransitioning ? (
            <View style={styles.loaderRow}>
              <ActivityIndicator color="#8a6c09" />
              <Text style={styles.loaderText}>Handing off to route navigation...</Text>
            </View>
          ) : null}
        </View>
      </View>

      <DeliveryRequestModal
        visible={Boolean(activeRequest)}
        request={activeRequest}
        secondsLeft={countdown}
        onAccept={handleAccept}
        onReject={() => handleReject(false)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#f3f6fb",
  },
  container: {
    flex: 1,
    padding: 20,
    justifyContent: "flex-start",
  },
  headerCard: {
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 18,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 4,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  logoutText: {
    color: "#8a6c09",
    fontWeight: "700",
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: "#111827",
  },
  subtitle: {
    color: "#6b7280",
    marginTop: 4,
  },
  badgeRow: {
    flexDirection: "row",
    marginTop: 12,
    gap: 8,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#f3f4f6",
  },
  badgeActive: {
    backgroundColor: "#d1fae5",
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#374151",
  },
  statusText: {
    marginTop: 10,
    color: "#4b5563",
  },
  completedCard: {
    marginTop: 12,
    backgroundColor: "#ecfdf5",
    borderRadius: 12,
    padding: 12,
  },
  completedTitle: {
    fontWeight: "700",
    color: "#065f46",
  },
  completedText: {
    color: "#065f46",
    marginTop: 4,
  },
  pendingCard: {
    marginTop: 16,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
  },
  pendingTitle: {
    fontWeight: "700",
    fontSize: 16,
    color: "#111827",
    marginBottom: 8,
  },
  pendingItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f3f4f6",
  },
  pendingItemTitle: {
    fontWeight: "600",
    color: "#111827",
  },
  pendingItemText: {
    color: "#6b7280",
    fontSize: 12,
  },
  pendingItemAction: {
    color: "#8a6c09",
    fontWeight: "700",
  },
  primaryAction: {
    marginTop: 16,
    backgroundColor: "#8a6c09",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  primaryActionText: {
    color: "#ffffff",
    fontWeight: "700",
  },
  centeredPanel: {
    marginTop: 20,
  },
  helperText: {
    color: "#6b7280",
    fontSize: 13,
    lineHeight: 18,
  },
  loaderRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 12,
    gap: 8,
  },
  loaderText: {
    color: "#8a6c09",
  },
});

export default DriverDashboard;
