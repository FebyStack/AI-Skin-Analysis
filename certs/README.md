# Local HTTPS certs (dev only)

Cameras and PWA install require HTTPS on phones/iPads. This folder holds a
locally-trusted certificate so `vite` serves `https://<your-mac-ip>:5173`
with no browser warnings.

**Nothing in this folder is committed.** Every developer sets it up once
on their own Mac.

## One-time setup (per Mac)

1. **Install mkcert** (adds a local certificate authority to your keychain):
   ```bash
   brew install mkcert nss
   mkcert -install
   ```
   `nss` is only needed if you plan to also test in Firefox on the Mac.
   `mkcert -install` will ask for your password once to trust the local CA.

2. **Find your Mac's LAN IP** (or hostname):
   ```bash
   ipconfig getifaddr en0     # Wi-Fi
   # or: hostname
   ```

3. **Generate the cert** covering every name/IP you'll use to reach the app.
   `scutil --get LocalHostName` gives the mDNS name without the `.local`
   suffix, so appending `.local` doesn't double up:
   ```bash
   cd "$(git rev-parse --show-toplevel)/certs"
   mkcert -key-file dev-key.pem -cert-file dev-cert.pem \
     localhost 127.0.0.1 ::1 \
     $(ipconfig getifaddr en0) \
     "$(scutil --get LocalHostName).local"
   ```

4. **Trust the CA on each phone/iPad you want to test on:**
   - Show the CA root path: `mkcert -CAROOT` → copy `rootCA.pem` off that path
   - **iPhone/iPad:** AirDrop `rootCA.pem` to it → tap it in Files → Settings
     will offer to install a profile → Settings → General → VPN & Device
     Management → install the mkcert profile → Settings → General → About
     → Certificate Trust Settings → toggle the mkcert CA to **on** (this
     step is required or Safari still shows a warning)
   - **Android:** transfer `rootCA.pem` to the phone → Settings → Security
     → Encryption & credentials → Install a certificate → CA certificate

5. **Run the app with HTTPS:**
   ```bash
   LESION_FAKE=1 npm run dev:lite
   ```
   You'll see `Network: https://192.168.x.x:5173/` — visit that URL on the
   phone. Camera should work, and Chrome/Safari will offer "Install".

## Fallback if you skip mkcert

`vite.config.ts` falls back to plain HTTP when no certs are present, so
`npm run dev` still works. Cameras and PWA install just won't work on the
phone until you finish the mkcert steps.
