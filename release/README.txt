SHS Music Studio v0.1.1-preview - Windows Portable (x64)
Based on HOT-Step CPP v1.4.2; upstream copyrights and licenses are preserved.
Repository and full guide: https://github.com/Songssh/shs-music-studio

FIRST RUN (Windows 10/11 x64)
1. Extract the entire ZIP into a writable folder.
2. Run Setup.bat and choose a separate data folder and HTTPS address.
   Defaults: ../SHS-Music-Studio-Data and https://localhost:3443.
   The localhost default accepts connections only from the server PC.
3. Run SHS-Music-Studio.bat (HOT-Step.bat is also supported).
4. Create the first administrator in the browser. The initial token is in
   <data>/library/auth-private/bootstrap-token, created at first server start
   and removed after setup. Passwords require at least 12 characters.
5. Shut down through the app menu or console Ctrl+C. Normal shutdown also
   cleans up the engine process owned by the server.

Node.js, npm, Python, and Visual Studio do not need separate installation.
The package includes Node 24, Better Auth, Kysely, SQLite native modules,
Sharp/libvips, FFmpeg, the compiled UI, C++ engine, and app-local MSVC DLLs.
CUDA packages include CUDA runtime libraries; a compatible NVIDIA driver
must already be installed. Model weights are separate. Accounts and library
screens work without models; generation requires installing suitable models.
External AI/API providers may require separate accounts and network access.

CONNECT FROM ANOTHER PC OR ANDROID ON THE SAME LAN
If portable.json says host=127.0.0.1 and url=https://localhost:3443, opening
the firewall alone will not enable access from other devices.

1. Stop the app and wait for its engine to exit.
2. Run Configure-LAN.bat and enter THIS server PC's LAN IPv4 address
   (use ipconfig to find it). Or, from PowerShell in the app folder:
     .\Configure-LAN.bat -Address 192.168.0.6
3. Start SHS-Music-Studio.bat or HOT-Step.bat again.
4. Use https://192.168.0.6:3443 on all clients, including the server PC.
   Substitute your server IP; the helper retains your configured port.
   Use HTTPS explicitly and log in again at the new address.
5. Trust the new public certificate on each client (see HTTPS below).

For older packages, download BOTH files and save them beside portable.json
and create-certificate.ps1 in the APP folder, not the data folder:
https://raw.githubusercontent.com/Songssh/shs-music-studio/main/release/Configure-LAN.bat
https://raw.githubusercontent.com/Songssh/shs-music-studio/main/release/Configure-LAN.ps1
No application rebuild is needed. Run as the Windows account used for Setup.

The helper updates url and host together and regenerates the certificate
for the private LAN IPv4 address. Accounts, models, data location, ports,
and other settings are preserved. It supports default self-signed TLS only;
PEM certificates and reverse-proxy installations need manual configuration.
Setup.bat preserves an existing portable.json and does not reconfigure it.

Backups of portable.json and the old TLS files are stored privately under:
  <data>/settings/tls/lan-backup-<timestamp>-<id>
The helper refuses occupied server/engine ports and attempts rollback if
replacement fails. To undo a successful change, stop the app, copy the backup's
portable.json to the app folder, and its server.pfx/server.crt to settings/tls.
The backup contains a private key: do not distribute it.

FIREWALL AND TROUBLESHOOTING
- Use a Private Windows network profile on your trusted home LAN. If access
  times out, run the New-NetFirewallRule command printed by the helper in an
  Administrator PowerShell. It allows only this app's runtime/node.exe and
  configured TCP port, on the Private profile, from LocalSubnet.
- Firewall rules and certificate trust are not changed automatically.
- Reserve the server's IP in the router. If it changes, run the helper again
  and trust the new certificate. LAN use does not need router port forwarding.
- Guest Wi-Fi or access-point client isolation may block device-to-device access.
- A certificate warning means HTTPS was reached: check certificate identity
  and client trust. Do not treat it as a firewall error.
- If the page loads but login returns 403, use exactly the URL in portable.json
  (including HTTPS and port) and restart after changing settings.
- The C++ engine stays on loopback; do not expose its port to LAN clients.

HTTPS
- Setup generates a self-signed certificate for the specified address (1 year).
  Verify its fingerprint through a trusted channel and trust the public
  <data>/settings/tls/server.crt on each client. On Windows, for example:
    certutil -hashfile "C:\path\to\server.crt" SHA256
    certutil -user -addstore Root "C:\path\to\server.crt"
  The second command changes the current user's trusted root store. Android
  certificate installation depends on the device/browser. Copy only the public
  .crt file to clients, never .pfx/.key files or backup folders.
- During first setup, a reachable server DNS name may be used instead of an IP.
  A non-loopback address binds the application to all network interfaces.
- Existing PEM full-chain certificate and private key, in a NEW app folder
  without portable.json:
    runtime\node.exe portable.mjs setup --yes --data-dir "D:\SHS-Music-Studio-Data" --url "https://music.example.com:3443" --cert "D:\cert\fullchain.pem" --key "D:\cert\privkey.pem"
- With a separate HTTPS reverse proxy:
    runtime\node.exe portable.mjs setup --yes --data-dir "D:\SHS-Music-Studio-Data" --url "https://music.example.com" --proxy --port 3001
  Preserve the original Host/Origin and forward to 127.0.0.1:3001. The proxy
  must terminate TLS; this mode has no direct TLS listener.
- Stop the server before replacing certificates and restart afterward.
  Setup and certificate generation do not require OpenSSL.

DATA AND UPGRADES
portable.json: data location, HTTPS address, ports, and TLS mode.
<data>/library: hotstep.db, music, images, training data, auth-private.
<data>/models, adapters: shared models and LoRAs.
<data>/settings: .env (other server options), tls (private certificates/keys).
<data>/profile, logs, tools, cache, tmp: runtime state and temporary files.
TLS and auth-private access is restricted to the setup Windows account and
SYSTEM. Review permissions before running under a different Windows account.

Stop the server and back up the complete data folder before upgrading.
Extract a new build into a different app folder and copy portable.json or use
Setup to select the same data directory. Relative paths are based on the app
folder; check them if the app moves. Deleting the app folder leaves data intact.
To move data, stop the server, move the data folder, and update portable.json.
In-app relocation is disabled because this launcher fixes an explicit path.
Personal databases, accounts, and models are not included in this package.
Use SHS builds for upgrades; the upstream updater can overwrite this fork.

VERIFICATION
Verify.bat uses bundled Node and disposable data to check SQLite, Sharp,
FFmpeg, TLS, initial administrator setup, login, image conversion, workspace
backgrounds, engine startup, persistence across restarts, and shutdown. It
prints JSON/log paths. Existing user data is not used. These local checks do
not represent a clean Windows VM, model inference, driver installation, or
verification of external AI providers.

Build record: release-manifest.json (versions, engine hash, locked dependencies).
Licenses: LICENSE, runtime/Node-LICENSE.txt, and dependency-specific notices.
Review THIRD_PARTY.md and RELEASE-NOTES.md for outstanding redistribution items.
