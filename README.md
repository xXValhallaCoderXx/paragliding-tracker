# XC MVP

An [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/) application using React Native and Expo Router.

The recommended Android workflow uses a **development build** installed on a physical device. The development build is created once, then normal TypeScript, React, route, and style changes are delivered by the local Expo development server with Fast Refresh.

## Requirements

- Node.js 22.13 or newer
- [pnpm](https://pnpm.io/installation)
- An Android 7 or newer physical device
- An [Expo account](https://expo.dev/signup) for the initial EAS build
- The computer and phone on the same Wi-Fi network during daily development

Android Studio, a local Android SDK, and USB debugging are not required when using the EAS cloud-build flow below.

## First-time Android setup

### 1. Install the project dependencies

From the project directory:

```bash
pnpm install
```

### 2. Add the Expo development client

```bash
pnpm exec expo install expo-dev-client
```

The development client is the device-side app that connects to the Expo development server. It also ensures that the installed Android app matches this project's Expo SDK and native dependencies.

### 3. Sign in to Expo

```bash
pnpm dlx eas-cli@latest login
```

### 4. Configure the project for EAS Build

```bash
pnpm dlx eas-cli@latest build:configure
```

Choose **Android** when prompted. On the first build, EAS may also ask for:

- An Android package name, such as `com.yourname.xcmvp`
- Permission to generate and manage a new Android signing key

The command creates an `eas.json` file containing a `development` build profile.

### 5. Create the development APK

```bash
pnpm dlx eas-cli@latest build --platform android --profile development
```

EAS builds an installable APK in the cloud. When it finishes:

1. Scan the build QR code with the Android device, or open the provided build link on it.
2. Download the APK.
3. If Android asks, allow the browser to install apps from this source.
4. Install and open the **xc-mvp** development app.

Only install APKs from a build link you trust.

## Daily development

The development APK does not need to be rebuilt for ordinary application changes.

### 1. Start the development server

```bash
pnpm start
```

Keep this terminal running while developing.

### 2. Connect the Android device

1. Put the computer and phone on the same Wi-Fi network.
2. Open the installed **xc-mvp** development app.
3. Select the detected development server or scan the QR code shown by Expo.

### 3. Edit the app

Application routes live in [`src/app`](./src/app). TypeScript, React, route, style, and most asset changes should appear on the device within seconds through Fast Refresh.

Stop the development server with <kbd>Ctrl</kbd>+<kbd>C</kbd>.

## When an Android rebuild is required

Create and install a new development APK after changing the native application, including when:

- Adding or updating a package containing native Android code
- Adding or changing an Expo config plugin
- Changing Android permissions or the Android package name
- Changing compiled app configuration such as the native icon or splash screen
- Upgrading Expo SDK or React Native

After making the change, rebuild with:

```bash
pnpm dlx eas-cli@latest build --platform android --profile development
```

Normal TypeScript, React, navigation, and styling changes do **not** require this rebuild.

## Connection troubleshooting

### The phone cannot reach the development server

First confirm that both devices are on the same Wi-Fi network and that neither device is using a VPN. If LAN access still fails—particularly when running the project through WSL2—restart Expo in tunnel mode:

```bash
pnpm exec expo start --tunnel
```

Tunnel mode is slower than LAN mode but avoids many router and WSL2 networking issues.

### Changes are not appearing

Close and reopen the development app, then restart Expo with a cleared bundler cache:

```bash
pnpm exec expo start --clear
```

If native dependencies or native configuration changed, create and install a new development APK instead.

## Other commands

```bash
# Run the web version
pnpm web

# Run ESLint
pnpm lint
```

## Documentation

- [Expo SDK 57 reference](https://docs.expo.dev/versions/v57.0.0/)
- [Development builds](https://docs.expo.dev/develop/development-builds/introduction/)
- [Using a development build](https://docs.expo.dev/develop/development-builds/use-development-builds/)
- [Expo Router](https://docs.expo.dev/router/introduction/)
