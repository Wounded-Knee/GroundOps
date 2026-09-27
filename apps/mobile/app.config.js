const appJson = require("./app.json");

const clientIdSuffix = ".apps.googleusercontent.com";

function reversedGoogleClientScheme(clientId) {
  if (!clientId || !clientId.endsWith(clientIdSuffix)) {
    return null;
  }
  const prefix = clientId.slice(0, -clientIdSuffix.length);
  return prefix ? `com.googleusercontent.apps.${prefix}` : null;
}

function googleSchemes() {
  const schemes = ["groundops"];
  const clientIds = [
    process.env.GOOGLE_ANDROID_CLIENT_ID,
    process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID,
    process.env.GOOGLE_IOS_CLIENT_ID,
    process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID,
  ];
  for (const clientId of clientIds) {
    const scheme = reversedGoogleClientScheme(clientId);
    if (scheme && !schemes.includes(scheme)) {
      schemes.push(scheme);
    }
  }
  return schemes;
}

module.exports = () => ({
  expo: {
    ...appJson.expo,
    scheme: googleSchemes(),
  },
});
