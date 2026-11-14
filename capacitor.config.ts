import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.betterkeep.app',
  appName: 'BetterKeep',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_betterkeep',
      iconColor: '#3B6652',
      sound: 'default',
    },
  },
  android: {
    allowMixedContent: false,
    backgroundColor: '#F6F7F4',
  },
};

export default config;
