import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import axios from "axios";
import AsyncStorage from "@react-native-async-storage/async-storage";
import baseUrl from "../../assets/common/baseUrl";

export const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const restoreSession = useCallback(async () => {
    setLoading(true);
    try {
      const storedToken = await AsyncStorage.getItem("driver_token");
      const storedUser = await AsyncStorage.getItem("driver_user");
      if (storedToken && storedUser) {
        setToken(storedToken);
        setUser(JSON.parse(storedUser));
      }
    } catch (restoreError) {
      console.warn("Unable to restore driver session:", restoreError);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    restoreSession();
  }, [restoreSession]);

  const login = useCallback(async (email, password) => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post(`${baseUrl}users/login`, { email, password });
      const { token: authToken, ...userData } = res.data;

      await AsyncStorage.setItem("driver_token", authToken);
      await AsyncStorage.setItem("driver_user", JSON.stringify(userData));

      setToken(authToken);
      setUser(userData);
      return { ok: true };
    } catch (loginError) {
      const message = loginError.response?.data?.message || "Login failed";
      setError(message);
      return { ok: false, message };
    } finally {
      setLoading(false);
    }
  }, []);

  const register = useCallback(async (name, email, password) => {
    setLoading(true);
    setError(null);
    try {
      const res = await axios.post(`${baseUrl}users/register`, {
        name,
        email,
        password,
        role: "driver",
      });
      const { token: authToken, ...userData } = res.data;

      if (authToken) {
        await AsyncStorage.setItem("driver_token", authToken);
        await AsyncStorage.setItem("driver_user", JSON.stringify(userData));
        setToken(authToken);
        setUser(userData);
      }

      return { ok: true, authenticated: Boolean(authToken) };
    } catch (registerError) {
      const message = registerError.response?.data?.message || "Registration failed";
      setError(message);
      return { ok: false, message };
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await AsyncStorage.removeItem("driver_token");
    await AsyncStorage.removeItem("driver_user");
    setToken(null);
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        error,
        isAuthenticated: Boolean(token),
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
