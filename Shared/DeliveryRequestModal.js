import React from "react";
import {
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

const DeliveryRequestModal = ({
  visible,
  request,
  secondsLeft,
  onAccept,
  onReject,
}) => {
  if (!request) {
    return null;
  }

  const pickupStoreName = request?.pickupStoreName || "Nearby Store";
  const totalDistance = request?.totalDistance || "4.8 km";
  const payout = request?.payout || "ETB 180";
  const customerName = request?.customerName || "Customer";

  return (
    <Modal transparent visible={visible} animationType="fade">
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Incoming delivery request</Text>
          <Text style={styles.countdown}>Respond in {secondsLeft}s</Text>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Pickup</Text>
            <Text style={styles.value}>{pickupStoreName}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Distance</Text>
            <Text style={styles.value}>{totalDistance}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Payout</Text>
            <Text style={styles.value}>{payout}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.label}>Customer</Text>
            <Text style={styles.value}>{customerName}</Text>
          </View>
          <View style={styles.actions}>
            <TouchableOpacity style={styles.rejectButton} onPress={onReject}>
              <Text style={styles.rejectButtonText}>Reject</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.acceptButton} onPress={onAccept}>
              <Text style={styles.acceptButtonText}>Accept</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(11, 17, 32, 0.63)",
    paddingHorizontal: 20,
  },
  card: {
    width: "100%",
    backgroundColor: "#ffffff",
    borderRadius: 18,
    padding: 20,
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 8,
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1f2937",
    marginBottom: 6,
  },
  countdown: {
    fontSize: 14,
    fontWeight: "600",
    color: "#8a6c09",
    marginBottom: 16,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f4f8",
  },
  label: {
    color: "#6b7280",
    fontSize: 14,
  },
  value: {
    color: "#111827",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "right",
    flexShrink: 1,
  },
  actions: {
    flexDirection: "row",
    marginTop: 20,
    gap: 12,
  },
  rejectButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#f3f4f6",
    alignItems: "center",
  },
  rejectButtonText: {
    color: "#4b5563",
    fontWeight: "700",
  },
  acceptButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#8a6c09",
    alignItems: "center",
  },
  acceptButtonText: {
    color: "#ffffff",
    fontWeight: "700",
  },
});

export default DeliveryRequestModal;
