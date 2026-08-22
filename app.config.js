const appJson = require("./app.json");

module.exports = ({ config }) => {
  const baseConfig = appJson.expo || config || {};
  const googleMapsApiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || "";

  return {
    ...baseConfig,
    extra: {
      ...(baseConfig.extra || {}),
      googleMapsApiKey,
    },
  };
};