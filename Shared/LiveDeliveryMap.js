import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import MapView, { Callout, Marker, Polyline } from "react-native-maps";
import * as Location from "expo-location";
import Constants from "expo-constants";

const DEFAULT_DRIVER_COORDINATES = {
  latitude: 8.9806,
  longitude: 38.7578,
};

const DEFAULT_PICKUP_COORDINATES = {
  latitude: 8.9851,
  longitude: 38.7642,
};

const DEFAULT_DELIVERY_COORDINATES = {
  latitude: 8.9834,
  longitude: 38.7761,
};

const toCoordinate = (value, fallback) => {
  const latitude = Number(value?.latitude ?? value?.lat);
  const longitude = Number(value?.longitude ?? value?.lng ?? value?.lon);

  if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
    return { latitude, longitude };
  }

  return fallback;
};

const getAddress = (location, fallback) => {
  if (typeof location === "string" && location.trim()) {
    return location.trim();
  }

  return (
    location?.address ||
    location?.formattedAddress ||
    location?.name ||
    fallback
  );
};

const decodePolyline = (encoded) => {
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  const coordinates = [];

  while (index < encoded.length) {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    latitude += result & 1 ? ~(result >> 1) : result >> 1;

    result = 0;
    shift = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    longitude += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push({
      latitude: latitude / 100000,
      longitude: longitude / 100000,
    });
  }

  return coordinates;
};

const LiveDeliveryMap = ({ delivery, driverId, onDriverLocation }) => {
  const pickup = useMemo(
    () => toCoordinate(delivery?.storeLocation, DEFAULT_PICKUP_COORDINATES),
    [delivery?.storeLocation]
  );
  const destination = useMemo(
    () => toCoordinate(delivery?.customerLocation, DEFAULT_DELIVERY_COORDINATES),
    [delivery?.customerLocation]
  );
  const [driverLocation, setDriverLocation] = useState(
    toCoordinate(delivery?.driverCoordinates, DEFAULT_DRIVER_COORDINATES)
  );
  const [roadRoute, setRoadRoute] = useState([]);
  const [locationMessage, setLocationMessage] = useState("Getting your live location...");

  useEffect(() => {
    const apiKey =
      process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ||
      Constants?.expoConfig?.extra?.googleMapsApiKey;

    if (!apiKey) {
      setRoadRoute([]);
      return undefined;
    }

    let cancelled = false;
    const loadRoadRoute = async () => {
      const origin = `${driverLocation.latitude},${driverLocation.longitude}`;
      const waypoints = `${pickup.latitude},${pickup.longitude}`;
      const destinationPoint = `${destination.latitude},${destination.longitude}`;
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destinationPoint}&waypoints=${waypoints}&mode=driving&key=${apiKey}`;
      const response = await fetch(url);
      const data = await response.json();
      const encodedRoute = data?.routes?.[0]?.overview_polyline?.points;
      if (!cancelled && encodedRoute) {
        setRoadRoute(decodePolyline(encodedRoute));
      }
    };

    loadRoadRoute().catch(() => {
      if (!cancelled) {
        setRoadRoute([]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [destination, driverLocation, pickup]);

  useEffect(() => {
    let subscription;
    let cancelled = false;

    const startLocationUpdates = async () => {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        if (!cancelled) {
          setLocationMessage("Location permission is required for live trip tracking");
        }
        return;
      }

      const currentPosition = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const currentLocation = toCoordinate(currentPosition.coords, driverLocation);
      if (!cancelled) {
        setDriverLocation(currentLocation);
        onDriverLocation?.({ ...currentLocation, driverId });
        setLocationMessage("Live location is active");
      }

      subscription = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          distanceInterval: 10,
          timeInterval: 5000,
        },
        (position) => {
          const nextLocation = toCoordinate(position.coords, driverLocation);
          setDriverLocation(nextLocation);
          onDriverLocation?.({ ...nextLocation, driverId });
        }
      );
    };

    startLocationUpdates().catch((error) => {
      if (!cancelled) {
        setLocationMessage(error?.message || "Unable to start live location tracking");
      }
    });

    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [driverId, onDriverLocation]);

  const routeCoordinates = roadRoute.length > 1 ? roadRoute : [driverLocation, pickup, destination];
  const region = {
    latitude: (driverLocation.latitude + pickup.latitude + destination.latitude) / 3,
    longitude: (driverLocation.longitude + pickup.longitude + destination.longitude) / 3,
    latitudeDelta: 0.035,
    longitudeDelta: 0.035,
  };
  const pickupAddress = getAddress(delivery?.storeLocation, delivery?.pickupStoreName || "Pickup location");
  const deliveryAddress = getAddress(delivery?.customerLocation, delivery?.customerName || "Delivery location");

  return (
    <View style={styles.wrapper}>
      <MapView style={styles.map} initialRegion={region} showsUserLocation>
        <Polyline coordinates={routeCoordinates} strokeColor="#176b87" strokeWidth={5} />
        <Marker coordinate={driverLocation} pinColor="#176b87">
          <Callout>
            <Text style={styles.calloutTitle}>You</Text>
            <Text>Live driver location</Text>
          </Callout>
        </Marker>
        <Marker coordinate={pickup} pinColor="#d97706">
          <Callout>
            <Text style={styles.calloutTitle}>Pickup</Text>
            <Text>{pickupAddress}</Text>
          </Callout>
        </Marker>
        <Marker coordinate={destination} pinColor="#be123c">
          <Callout>
            <Text style={styles.calloutTitle}>Delivery</Text>
            <Text>{deliveryAddress}</Text>
          </Callout>
        </Marker>
      </MapView>
      <View style={styles.tripSummary}>
        <View style={styles.summaryRow}>
          <View style={[styles.dot, styles.pickupDot]} />
          <View style={styles.summaryText}>
            <Text style={styles.summaryLabel}>PICKUP</Text>
            <Text style={styles.summaryValue} numberOfLines={1}>{pickupAddress}</Text>
          </View>
        </View>
        <View style={styles.connector} />
        <View style={styles.summaryRow}>
          <View style={[styles.dot, styles.deliveryDot]} />
          <View style={styles.summaryText}>
            <Text style={styles.summaryLabel}>DELIVERY</Text>
            <Text style={styles.summaryValue} numberOfLines={1}>{deliveryAddress}</Text>
          </View>
        </View>
        <Text style={styles.locationMessage}>{locationMessage}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginTop: 16,
    overflow: "hidden",
    borderRadius: 14,
    backgroundColor: "#ffffff",
  },
  map: {
    height: 250,
    width: "100%",
  },
  tripSummary: {
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  summaryRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  pickupDot: {
    backgroundColor: "#d97706",
  },
  deliveryDot: {
    backgroundColor: "#be123c",
  },
  connector: {
    height: 14,
    width: 1,
    marginLeft: 4,
    backgroundColor: "#cbd5e1",
  },
  summaryText: {
    flex: 1,
  },
  summaryLabel: {
    color: "#64748b",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  summaryValue: {
    color: "#0f172a",
    fontSize: 13,
    fontWeight: "600",
    marginTop: 2,
  },
  locationMessage: {
    color: "#64748b",
    fontSize: 11,
    marginTop: 10,
  },
  calloutTitle: {
    fontWeight: "700",
    marginBottom: 2,
  },
});

export default LiveDeliveryMap;
