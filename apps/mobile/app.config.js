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

module.exports = () => {
  const android = appJson.expo.android ?? {};
  return {
    expo: {
      ...appJson.expo,
      scheme: googleSchemes(),
      android: {
        ...android,
        permissions: [
          ...(android.permissions ?? []),
          "ACCESS_COARSE_LOCATION",
          "ACCESS_FINE_LOCATION",
          "ACCESS_BACKGROUND_LOCATION",
          "FOREGROUND_SERVICE",
          "FOREGROUND_SERVICE_LOCATION",
          // TaskManager persists location jobs across reboot; JobScheduler requires this.
          "RECEIVE_BOOT_COMPLETED",
          "WAKE_LOCK",
        ],
        config: {
          ...(android.config ?? {}),
          googleMaps: {
            apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? "",
          },
        },
      },
      plugins: [
        ...(appJson.expo.plugins ?? []),
        "expo-sqlite",
        "@react-native-community/datetimepicker",
        [
          "expo-maps",
          {
            requestLocationPermission: true,
            locationPermission: "Allow Groundops to use your location while you navigate.",
          },
        ],
        [
          "expo-location",
          {
            locationWhenInUsePermission: "Allow Groundops to use your location while you navigate.",
            locationAlwaysAndWhenInUsePermission:
              "Allow Groundops to use your location in the background so schedule windows stay accurate.",
            isIosBackgroundLocationEnabled: true,
            isAndroidBackgroundLocationEnabled: true,
            isAndroidForegroundServiceEnabled: true,
          },
        ],
        "expo-task-manager",
      ],
    },
  };
};
