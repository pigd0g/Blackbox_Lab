# Installing Blackbox Lab

Blackbox Lab installs like most community-built RC software —
the same way the Rotorflight Configurator and the Betaflight
Blackbox Explorer do. Your operating system may show a warning
the first time because the installers are not commercially
signed; the steps below get you through it in a few clicks.

## Windows

1. Download `Blackbox.Lab-<version>.Setup.exe` from the release
   page and run it.
2. If Windows shows a blue **"Windows protected your PC"**
   screen, click **More info**, then **Run anyway**. (SmartScreen
   shows this for any new unsigned app — the Rotorflight
   Configurator gets the same screen.)
3. The installer runs silently — no wizard — and launches
   Blackbox Lab when it's done. That's normal: it installs to
   your user profile and puts a shortcut in the Start menu.

Updating: installing a newer Setup.exe over an existing install
updates it in place. Your Health Record and settings are kept.

## macOS

1. Download the zip for your Mac — `arm64` for Apple Silicon
   (M1/M2/M3/M4), `x64` for Intel — and unzip it.
2. Move **Blackbox Lab.app** to Applications.
3. macOS will likely say the app **"is damaged and can't be
   opened"**. It isn't damaged — that is Gatekeeper's message for
   apps that aren't notarized with Apple (the Rotorflight
   Configurator needs the same step). Open Terminal and run:

   ```
   xattr -cr "/Applications/Blackbox Lab.app"
   ```

4. Open the app normally.

## Linux

- **Debian/Ubuntu:** `sudo dpkg -i blackbox-lab_<version>_amd64.deb`
- **Fedora/openSUSE:** `sudo rpm -i blackbox-lab-<version>.x86_64.rpm`
- **Any distribution:** unzip the zip build and run
  `blackbox-lab` from the folder.

## Where your data lives

Everything Blackbox Lab analyzes stays on your computer. Your
Health Record, model cards and settings live in your user
profile and survive updates. Sharing anything is always your
choice, per action, in the app.
