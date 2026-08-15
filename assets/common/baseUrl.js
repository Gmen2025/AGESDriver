// Must point at the same backend as the easy_shopping customer app.
const PRODUCTION_URL = "https://easy-shop-server-wldr.onrender.com/api/v1/";

const baseUrl =
  process.env.EXPO_PUBLIC_API_URL || PRODUCTION_URL;

export default baseUrl;
