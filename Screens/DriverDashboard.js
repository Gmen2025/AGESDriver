import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Audio } from "expo-av";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";

import DeliveryRequestModal from "../Shared/DeliveryRequestModal";
import LiveDeliveryMap from "../Shared/LiveDeliveryMap";
import {
  disconnectDriverSocket,
  emitDriverEvent,
  getDriverSocket,
  getSocketEventNames,
  registerDriverSocket,
} from "../assets/common/socketClient";
import { useAuth } from "../Context/store/Auth";
import {
  addDriverNotificationListener,
  addDriverNotificationResponseListener,
  registerDriverPushToken,
  removeDriverNotificationListener,
} from "../assets/common/notifications";
import { updateDeliveryStatus } from "../assets/common/delivery";
import baseUrl from "../assets/common/baseUrl";

const DEFAULT_DRIVER_COORDINATES = {
  latitude: 8.9806,
  longitude: 38.7578,
};

const normalizeDeliveryRequest = (payload = {}) => ({
  id: payload?.orderId || payload?.id || payload?.order?._id || `delivery-${Date.now()}`,
  pickupStoreName: payload?.pickupStoreName || payload?.order?.store?.name || payload?.store?.name || "North Hub Store",
  totalDistance: payload?.totalDistance || "4.8 km",
  payout: payload?.payout || "ETB 220",
  customerName: payload?.customerName || payload?.order?.customer?.name || payload?.customer?.name || "Customer",
  customerLocation: payload?.customerLocation || payload?.order?.customerLocation || payload?.customer?.location || null,
  storeLocation: payload?.storeLocation || payload?.order?.store?.location || payload?.store?.location || null,
  rawPayload: payload,
});

const DriverDashboard = () => {
  const { logout, user, token } = useAuth();
  const [socketConnected, setSocketConnected] = useState(false);
  const [activeRequest, setActiveRequest] = useState(null);
  const [countdown, setCountdown] = useState(30);
  const [statusText, setStatusText] = useState("Preparing dispatcher connection...");
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [isAlertPlaying, setIsAlertPlaying] = useState(false);
  const [completedDelivery, setCompletedDelivery] = useState(null);
  const [acceptedDelivery, setAcceptedDelivery] = useState(null);
  const [pendingDeliveries, setPendingDeliveries] = useState([]);
  const [serviceRequests, setServiceRequests] = useState([]);
  const [serviceLoading, setServiceLoading] = useState(true);
  const soundRef = useRef(null);
  const timerRef = useRef(null);
  const mountedRef = useRef(true);

  const loadServiceRequests = useCallback(async () => {
    if (!token) {
      return;
    }

    try {
      setServiceLoading(true);
      const response = await fetch(`${baseUrl}service-requests/assigned`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        throw new Error(`Service requests unavailable (${response.status})`);
      }
      setServiceRequests(await response.json());
    } catch (error) {
      console.warn("Unable to load assigned service requests:", error?.message || error);
    } finally {
      setServiceLoading(false);
    }
  }, [token]);

  const updateServiceStatus = useCallback(async (requestId, status) => {
    try {
      const response = await fetch(`${baseUrl}service-requests/${requestId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ status }),
      });
      if (!response.ok) {
        throw new Error((await response.text()) || "Unable to update service request");
      }
      const updated = await response.json();
      setServiceRequests((requests) => requests.map((request) => request._id === requestId ? updated : request));
    } catch (error) {
      setStatusText(error?.message || "Unable to update service request");
    }
  }, [token]);

  useEffect(() => {
    loadServiceRequests();
  }, [loadServiceRequests]);

  const handleDriverLocation = useCallback((location) => {
    emitDriverEvent("driver_location_updated", {
      orderId: acceptedDelivery?.id,
      driverId: location.driverId,
      latitude: location.latitude,
      longitude: location.longitude,
      recordedAt: new Date().toISOString(),
    }, token).catch((error) => {
      console.warn("Unable to emit driver location:", error?.message || error);
    });
  }, [acceptedDelivery?.id, token]);

  useEffect(() => {
    let subscription;
    let cancelled = false;

    const startLocationTracking = async () => {
      if (!token || !user?._id) {
        return;
      }

      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted" || cancelled) {
        return;
      }

      const emitLocation = (coords) => {
        handleDriverLocation({
          driverId: user._id,
          latitude: coords.latitude,
          longitude: coords.longitude,
        });
      };

      const currentPosition = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      if (!cancelled) {
        emitLocation(currentPosition.coords);
      }

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          distanceInterval: 25,
          timeInterval: 10000,
        },
        (position) => {
          if (!cancelled) {
            emitLocation(position.coords);
          }
        }
      );
    };

    startLocationTracking().catch((error) => {
      console.warn("Unable to start driver location tracking:", error?.message || error);
    });

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [handleDriverLocation, token, user?._id]);

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
    setAcceptedDelivery(request);
    setStatusText("Pending delivery loaded");
  }, []);

  const handlePushDelivery = useCallback((notification) => {
    const data = notification?.request?.content?.data || {};
    if (data.type === "service_request_assigned" && data.request) {
      setServiceRequests((requests) => [
        data.request,
        ...requests.filter((request) => request._id !== data.request._id),
      ]);
      setStatusText("New service job assigned");
      return;
    }
    if (data.type !== "delivery_assigned" && !data.orderId) {
      return;
    }

    const request = normalizeDeliveryRequest(data.order || data);
    setActiveRequest(request);
    setCountdown(30);
    setStatusText(`Incoming delivery from ${request.pickupStoreName}`);
    playAlert();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
  }, [playAlert]);

  const handlePushResponse = useCallback((response) => {
    handlePushDelivery(response?.notification);
  }, [handlePushDelivery]);

  useEffect(() => {
    const driverId = process.env.EXPO_PUBLIC_DRIVER_ID || user?._id;
    registerDriverPushToken(driverId, token).catch((error) => {
      console.warn("Driver push registration failed:", error?.message || error);
    });

    const subscription = addDriverNotificationListener(handlePushDelivery);
    const responseSubscription = addDriverNotificationResponseListener(handlePushResponse);
    return () => {
      removeDriverNotificationListener(subscription);
      removeDriverNotificationListener(responseSubscription);
    };
  }, [handlePushDelivery, handlePushResponse, token, user?._id]);

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
    setAcceptedDelivery(request);
    setStatusText("Delivery accepted. Review the delivery details below.");
    setIsTransitioning(false);
  }, [activeRequest, resetRequestState]);

  useEffect(() => {
    mountedRef.current = true;
    let socketRef = null;

    const attachSocketListeners = async () => {
      try {
        const socket = await getDriverSocket(token);
        if (!mountedRef.current) {
          return;
        }

        socketRef = socket;
        setSocketConnected(true);
        setStatusText("Connected to dispatcher. Waiting for requests...");

        const { deliveryEvent, statusEvent } = getSocketEventNames();
        registerDriverSocket({
          driverId: user?._id || process.env.EXPO_PUBLIC_DRIVER_ID || "demo-driver",
          authToken: token,
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

        const handleServiceAssigned = (payload) => {
          const request = payload?.request;
          if (!request) {
            return;
          }
          setServiceRequests((requests) => [
            request,
            ...requests.filter((item) => item._id !== request._id),
          ]);
          setStatusText(`New service job assigned: ${request.machineType || "Machine service"}`);
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
        socket.on("service_request_assigned", handleServiceAssigned);
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
          socket.off("service_request_assigned", handleServiceAssigned);
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
  }, [playAlert, stopAlert, token, user?._id]);

  const markDeliveryStatus = useCallback(async (deliveryStatus) => {
    if (!acceptedDelivery) {
      return;
    }

    try {
      await updateDeliveryStatus(acceptedDelivery.id, deliveryStatus);
      if (deliveryStatus === "Delivered") {
        setCompletedDelivery(acceptedDelivery);
        setAcceptedDelivery(null);
        setStatusText("Delivery completed. Waiting for the next request.");
      } else {
        setStatusText(`Delivery status updated to ${deliveryStatus}.`);
      }
    } catch (error) {
      setStatusText(error?.message || "Unable to update delivery status");
    }
  }, [acceptedDelivery]);

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

        <View style={styles.serviceCard}>
          <View style={styles.serviceHeaderRow}>
            <Text style={styles.serviceTitle}>Assigned service jobs</Text>
            <TouchableOpacity onPress={loadServiceRequests}>
              <Text style={styles.serviceRefresh}>Refresh</Text>
            </TouchableOpacity>
          </View>
          {serviceLoading ? <ActivityIndicator color="#8a6c09" /> : null}
          {!serviceLoading && serviceRequests.length === 0 ? (
            <Text style={styles.serviceEmpty}>No machine repair jobs assigned.</Text>
          ) : null}
          {serviceRequests.map((request) => (
            <View key={request._id} style={styles.serviceItem}>
              <Text style={styles.serviceItemTitle}>{request.machineType || "Machine service"}</Text>
              <Text style={styles.serviceItemText}>{request.customer?.name || "Customer"} · {request.serviceLocation || "Location pending"}</Text>
              <Text style={styles.serviceItemText}>{request.problemDescription || "No description"}</Text>
              <View style={styles.serviceActions}>
                <TouchableOpacity style={styles.serviceAction} onPress={() => updateServiceStatus(request._id, "in_progress")}>
                  <Text style={styles.serviceActionText}>Start job</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.serviceAction} onPress={() => updateServiceStatus(request._id, "completed")}>
                  <Text style={styles.serviceActionText}>Complete</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>

        <TouchableOpacity style={styles.primaryAction} onPress={simulateDemoRequest}>
          <Text style={styles.primaryActionText}>Simulate incoming request</Text>
        </TouchableOpacity>

        <View style={styles.centeredPanel}>
          {acceptedDelivery ? (
            <View style={styles.activeDeliveryCard}>
              <Text style={styles.activeDeliveryTitle}>Active delivery</Text>
              <Text style={styles.activeDeliveryText}>Pickup: {acceptedDelivery.pickupStoreName}</Text>
              <Text style={styles.activeDeliveryText}>Customer: {acceptedDelivery.customerName}</Text>
              <View style={styles.deliveryActions}>
                <TouchableOpacity
                  style={styles.secondaryAction}
                  onPress={() => markDeliveryStatus("Picked Up")}
                >
                  <Text style={styles.secondaryActionText}>Mark picked up</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.primaryAction}
                  onPress={() => markDeliveryStatus("Delivered")}
                >
                  <Text style={styles.primaryActionText}>Mark delivered</Text>
                </TouchableOpacity>
              </View>
              <LiveDeliveryMap
                delivery={acceptedDelivery}
                driverId={user?._id || process.env.EXPO_PUBLIC_DRIVER_ID || "demo-driver"}
              />
            </View>
          ) : null}
          {isTransitioning ? (
            <View style={styles.loaderRow}>
              <ActivityIndicator color="#8a6c09" />
              <Text style={styles.loaderText}>Accepting delivery...</Text>
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
  activeDeliveryCard: {
    marginTop: 16,
    backgroundColor: "#fff7ed",
    borderRadius: 12,
    padding: 12,
  },
  activeDeliveryTitle: {
    fontWeight: "700",
    color: "#9a3412",
  },
  activeDeliveryText: {
    color: "#7c2d12",
    marginTop: 4,
  },
  deliveryActions: {
    flexDirection: "row",
    gap: 10,
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
  serviceCard: {
    marginTop: 16,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 16,
  },
  serviceHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  serviceTitle: {
    fontWeight: "700",
    fontSize: 16,
    color: "#111827",
  },
  serviceRefresh: {
    color: "#8a6c09",
    fontWeight: "700",
  },
  serviceEmpty: {
    color: "#6b7280",
    fontSize: 13,
  },
  serviceItem: {
    borderTopWidth: 1,
    borderTopColor: "#f3f4f6",
    paddingVertical: 12,
  },
  serviceItemTitle: {
    color: "#111827",
    fontWeight: "700",
  },
  serviceItemText: {
    color: "#6b7280",
    fontSize: 13,
    marginTop: 4,
  },
  serviceActions: {
    flexDirection: "row",
    gap: 8,
    marginTop: 10,
  },
  serviceAction: {
    backgroundColor: "#ecfdf5",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  serviceActionText: {
    color: "#166534",
    fontWeight: "700",
    fontSize: 12,
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
  secondaryAction: {
    flex: 1,
    marginTop: 16,
    backgroundColor: "#e5e7eb",
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: "center",
  },
  secondaryActionText: {
    color: "#374151",
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
