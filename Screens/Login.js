import React, { useState } from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../Context/store/Auth";

const Login = () => {
  const { login, register, loading, error } = useAuth();
  const [isRegistering, setIsRegistering] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const handleLogin = () => {
    if (isRegistering && (!name.trim() || !email || !password || !confirmPassword)) {
      return;
    }
    if (!isRegistering && (!email || !password)) {
      return;
    }
    if (isRegistering && password !== confirmPassword) {
      return;
    }

    if (isRegistering) {
      register(name.trim(), email.trim().toLowerCase(), password);
      return;
    }

    login(email.trim().toLowerCase(), password);
  };

  const toggleMode = () => {
    setIsRegistering((currentMode) => !currentMode);
    setName("");
    setEmail("");
    setPassword("");
    setConfirmPassword("");
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>AGES Driver</Text>
        <Text style={styles.subtitle}>
          {isRegistering ? "Create your driver account" : "Sign in with your driver account"}
        </Text>

        {isRegistering ? (
          <TextInput
            style={styles.input}
            placeholder="Full name"
            autoCapitalize="words"
            value={name}
            onChangeText={setName}
          />
        ) : null}

        <TextInput
          style={styles.input}
          placeholder="Email"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />

        {isRegistering ? (
          <TextInput
            style={styles.input}
            placeholder="Confirm password"
            secureTextEntry
            value={confirmPassword}
            onChangeText={setConfirmPassword}
          />
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {isRegistering && password && confirmPassword && password !== confirmPassword ? (
          <Text style={styles.error}>Passwords do not match</Text>
        ) : null}

        <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={loading}>
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.buttonText}>{isRegistering ? "Register" : "Sign In"}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity onPress={toggleMode} disabled={loading} style={styles.modeButton}>
          <Text style={styles.modeButtonText}>
            {isRegistering ? "Already have an account? Sign in" : "New driver? Register here"}
          </Text>
        </TouchableOpacity>
      </View>
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
    justifyContent: "center",
    padding: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: "700",
    color: "#111827",
    textAlign: "center",
  },
  subtitle: {
    marginTop: 6,
    marginBottom: 24,
    color: "#6b7280",
    textAlign: "center",
  },
  input: {
    backgroundColor: "#ffffff",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  error: {
    color: "#dc2626",
    marginBottom: 12,
    textAlign: "center",
  },
  button: {
    backgroundColor: "#8a6c09",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: {
    color: "#ffffff",
    fontWeight: "700",
    fontSize: 16,
  },
  modeButton: {
    alignItems: "center",
    marginTop: 18,
  },
  modeButtonText: {
    color: "#8a6c09",
    fontWeight: "600",
  },
});

export default Login;
