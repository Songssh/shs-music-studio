# SHS Music Studio

**An AI music studio combining a Windows production workspace with a multi-user server.** Share the server's GPU and installed models while keeping each account's music, images, and production drafts separate. Android devices connect through the existing mobile browser UI.

[Repository](https://github.com/Songssh/shs-music-studio) · [Issues](https://github.com/Songssh/shs-music-studio/issues) · [Releases](https://github.com/Songssh/shs-music-studio/releases)

**Version: v0.1.0-preview.** This repository contains the source and Windows Portable packaging tools. Portable builds have been checked locally; binary publication is subject to the outstanding provenance and redistribution items in [THIRD_PARTY.md](THIRD_PARTY.md). See Releases for available downloads. GitHub's source ZIP does not include a ready-to-run application, dependencies, or model weights.

SHS Music Studio is an independent modification of [HOT-Step CPP](https://github.com/scragnog/HOT-Step-CPP) **v1.4.2**. Original copyrights and licenses are preserved. Discord, donation, and download links in the archived [upstream README](README-UPSTREAM.md) belong to HOT-Step, not SHS.

## Fix LAN access in an existing Portable installation

If the app works on the server PC but other devices cannot open `https://192.168.0.6:3443`, check `portable.json`. The default `url: https://localhost:3443` and `host: 127.0.0.1` accept connections only from the server itself. Opening the firewall alone does not change that binding. Running `Setup.bat` again preserves the existing configuration.

1. Stop the app through its shutdown menu or console Ctrl+C. Wait for the server and engine to exit.
2. Download **both** [Configure-LAN.bat](https://raw.githubusercontent.com/Songssh/shs-music-studio/main/release/Configure-LAN.bat) and [Configure-LAN.ps1](https://raw.githubusercontent.com/Songssh/shs-music-studio/main/release/Configure-LAN.ps1). Save the raw files, not the GitHub HTML page. Put them in the extracted **app folder**, beside `portable.json`, `create-certificate.ps1`, and `runtime`. No application rebuild or model download is needed.
3. Double-click `Configure-LAN.bat` and enter the **server PC's** private IPv4 address shown by `ipconfig`. Or run this in PowerShell in the app folder:

   ```powershell
   .\Configure-LAN.bat -Address 192.168.0.6
   ```

4. Start `SHS-Music-Studio.bat` or `HOT-Step.bat`. Use **`https://192.168.0.6:3443` on every device, including the server PC**. Replace the example IP with your server's address; the helper keeps your configured port. Use HTTPS explicitly and log in again at the new address.
5. Trust the new public certificate on each client as described below. If connections time out, follow the firewall instructions printed by the helper.

The helper updates `url` and `host` together and generates a self-signed certificate whose subject alternative name includes the LAN IP. It preserves the data path, ports, accounts, library, models, and other settings. Before replacing anything, it backs up `portable.json`, `server.pfx`, and `server.crt` under `<data>/settings/tls/lan-backup-<timestamp>-<id>`. It refuses to run while the server or engine port is occupied and attempts to restore the previous files if replacement fails.

Run it as the same Windows account that ran Setup. The helper supports default **self-signed TLS with a private IPv4 address** (`10.x.x.x`, `172.16–31.x.x`, or `192.168.x.x`). It refuses PEM and reverse-proxy installations; update their URL and matching certificate/proxy settings manually. It does not change Windows certificate trust or firewall rules automatically.

To undo the change, stop the app and copy the backup's `portable.json` to the app folder and its `server.pfx`/`server.crt` to `<data>/settings/tls`. Keep this backup private because it contains a private key. Reserve the server IP in the router's DHCP settings; rerun the helper and trust the new certificate if the address changes.

### Windows firewall and certificate trust

For a trusted home LAN, set the server's Windows network profile to **Private**. If the app is still unreachable, run the helper's printed `New-NetFirewallRule` command in an **Administrator PowerShell**. It permits only the configured TCP port for that installation's `runtime\node.exe`, on the Private profile, from `LocalSubnet`. The engine remains bound to loopback. Router port forwarding is not needed for devices on the same LAN; guest Wi-Fi or access-point client isolation can still block them.

The self-signed certificate is valid for the configured address for one year. Verify its fingerprint through a trusted channel, then trust **only the public** `<data>/settings/tls/server.crt` on each client. For a Windows client, after copying that public file:

```powershell
certutil -hashfile "C:\path\to\server.crt" SHA256
certutil -user -addstore Root "C:\path\to\server.crt"
```

The second command changes the current Windows user's trusted root store. Android certificate installation depends on the device and browser. Never distribute `.pfx`, `.key`, or backup folders.

| Symptom | Check |
|---|---|
| Connection refused or timed out | Server running, correct server IP, `host: 0.0.0.0`, Private-profile firewall rule, and router/client isolation. |
| Certificate warning | HTTPS was reached. Check that the current certificate matches the IP and is trusted by that client. An old `localhost` certificate does not match a LAN IP. |
| Page loads but login returns 403 | The browser address must match `portable.json`'s `url`, including HTTPS and port. Restart after configuration changes. |
| Helper reports an occupied port | Shut down the app and its engine normally, or identify the other program using that port. |

## Included features

| Feature | Scope |
|---|---|
| **Windows Workspace** | Docked, tabbed, and detached tool windows; window activation and keyboard controls; per-user layout, theme, and background. |
| **Multi-user accounts** | Better Auth sign-in, one-time administrator setup, administrator/user roles, open/invite/closed registration, invitations, bans, administrator password resets, and personal DAW keys. |
| **Personal work data** | Ownership checks for music, images, training data, jobs, and drafts, with browser state separated by account. |
| **Shared models and GPU** | Shared installed models and compute, separate model-management permissions, and a common generation/training queue. |
| **Image library** | Uploads, originals, thumbnails, display variants, cropping/export, cover art, workspace backgrounds, and private/shared access controls. |
| **Windows Portable tooling** | Bundled runtime/server/UI/native modules/C++ engine, HTTPS, separate app/data folders, initial setup, LAN reconfiguration, shutdown/restart, and disposable-data verification. |
| **Android browser UI** | Existing mobile screens connected to the server, with model/GPU work performed on the server. No native Android app is included. |

Windows clients use Workspace by default. Mobile layout preservation and local browser checks do not constitute verification of every production flow on physical Android devices.

## Music production tools

The inherited HOT-Step CPP tools remain available, subject to installed models, engine support, and hardware:

- **AI music generation:** ACE-Step 1.5, MiniMax-Music3, YuE2, Auto-Gen, and Custom-Gen.
- **Editing and reinterpretation:** Cover, Repaint, Lyric Studio, and STORM.
- **Training and post-processing:** Training Studio LoRA/LoKr, stem separation/mixing, MIDI Studio, mastering, VST3 processing, and Lua plugins.
- **Music management:** Library, playback, playlists, and production drafts.

The [user documentation](docs/README.md) includes upstream feature guides. Follow this README for SHS installation, authentication, server access, and updates; upstream download and automatic-update instructions are not SHS distribution instructions.

## Planned work

These items are not implemented in this preview and have no committed delivery date:

| Item | Status |
|---|---|
| **RVC** | Voice-conversion engine, model management, and UI integration under consideration. |
| **HeartMuLa** | Music backend and generation-flow integration under consideration. |
| **SHS automatic updates and distribution** | Requires SHS-specific verification and publication policies. Inherited GitHub Actions are restricted in this fork. |

## Windows Portable setup

Use a writable folder on Windows 10/11 x64. The locally checked CUDA candidate targets CUDA 13 / x64 and requires a compatible NVIDIA GPU driver. Other GPU/platform combinations need separate verification.

1. Obtain the SHS Portable ZIP and its matching checksum file. Compare the SHA-256 before extracting:

   ```powershell
   Get-FileHash .\SHS-Music-Studio-v0.1.0-preview-win-x64-cuda.zip -Algorithm SHA256
   ```

2. Extract the ZIP completely and run `Setup.bat`. Choose a separate data folder and HTTPS address. Defaults: `SHS-Music-Studio-Data` beside the app folder, and `https://localhost:3443` for access from that PC only.
3. For LAN use, choose the server's reachable address during Setup, or run `Configure-LAN.bat` afterward.
4. Run `SHS-Music-Studio.bat`; `HOT-Step.bat` is also supported.
5. Create the first administrator using `<data>/library/auth-private/bootstrap-token`, generated at first server start and deleted after successful setup. There is no shared default account/password. Passwords require at least 12 characters.
6. Install model weights separately through Model Manager or another source permitted by the model's terms. Account and music/image management screens work without installed models.
7. Shut down through the app menu or console Ctrl+C so the server also cleans up its engine process.

Portable use does not require a separate Node.js, npm, Python, or Visual Studio installation. External AI/API providers may require their own accounts and network access.

### Custom certificates and reverse proxies

A new app folder without `portable.json` can use an existing full-chain PEM certificate and private key:

```powershell
.\runtime\node.exe portable.mjs setup --yes --data-dir "D:\SHS-Music-Studio-Data" --url "https://music.example.com:3443" --cert "D:\cert\fullchain.pem" --key "D:\cert\privkey.pem"
```

For a separately managed HTTPS reverse proxy:

```powershell
.\runtime\node.exe portable.mjs setup --yes --data-dir "D:\SHS-Music-Studio-Data" --url "https://music.example.com" --proxy --port 3001
```

The proxy must preserve the original Host/Origin and forward to `127.0.0.1:3001`. This mode has no direct TLS listener: TLS termination at the proxy is required. Use the configured HTTPS address on all clients. Stop the server before replacing certificates and restart afterward.

## Data, upgrades, and security scope

- `portable.json` stores the data location, URL, ports, and TLS mode. The separate data folder contains `library` (database, music, images, authentication data), `settings` (environment and TLS), and `models`/`adapters` (shared weights/LoRAs). Actual user data, accounts, session secrets, and keys do not belong in Git or distribution ZIPs.
- Before upgrading, stop the server and back up the complete data folder. Extract the new SHS build into a new app folder and connect it to the existing data path. Relative paths in `portable.json` are relative to the app folder; check them when moving the app. Avoid the upstream automatic updater, which can overwrite this fork.
- The launcher fixes an explicit data path, so in-app relocation is disabled. For a manual move, stop the server, move the data folder, and update `portable.json`.
- TLS and `auth-private` folders are restricted to the Windows account used during setup and SYSTEM. Review access permissions before changing the account that runs the server.
- `HOT_STEP_*`, existing database/API names, and some HOT-Step UI labels remain for compatibility.
- Email verification and email-based password recovery are not provided; use administrator password resets. STORM retains its existing stop-on-disconnect streaming behavior.
- Verification does not cover an external security audit, a clean Windows VM, every physical Android flow, or every GPU/driver combination. Review TLS, firewall, account policies, and backups before operating a public server.

## Development and verification

```powershell
git clone --recurse-submodules https://github.com/Songssh/shs-music-studio.git
cd shs-music-studio
npm.cmd --prefix server ci
npm.cmd --prefix ui ci
npm.cmd --prefix release ci
npm.cmd --prefix server run typecheck
npm.cmd --prefix ui run build
node --test release/configure-lan.test.mjs
```

The Portable build baseline is Node 24.18.0. C++ builds require Visual Studio C++ tools and the selected CUDA/Vulkan SDK. See the [engine documentation](engine/README.md), [architecture](docs/dev/architecture.md), and [.gitmodules](.gitmodules). Source ZIPs may omit submodule contents; fetch the pinned revisions separately.

```powershell
.\release\build-release.ps1 -Version 0.1.0-preview -Variant cuda -BuildBackend cuda
```

`Start-Workspace.*` and `tools/workspace/` are development helpers requiring a separate `../auth-environment/runtime` and development `.env`. Portable users should use the packaged launchers. Development accounts and session files are not distributed.

`Verify.bat` uses the bundled Node runtime with temporary data and random passwords to check HTTPS, accounts, images, restart persistence, and shutdown. LAN regression tests use disposable folders to check configuration changes, certificate identity, HTTPS, backups, and refusal/failure paths. These checks do not replace real model generation/training or testing on a clean PC.

## Attribution and licenses

The upstream MIT [LICENSE](LICENSE), [engine license](engine/LICENSE), vendored-code notices, and dependency licenses are preserved. The SHS name does not replace upstream copyrights or third-party license obligations.

[THIRD_PARTY.md](THIRD_PARTY.md) records outstanding Essentia, FFmpeg/Sharp, CUDA/MSVC, engine provenance, and corresponding-source items. Resolve applicable redistribution requirements before publishing binary releases. The [preview release notes](docs/publication/v0.1.0-preview.md) describe the prepared candidate.
