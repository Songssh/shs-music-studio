# Binary redistribution review — 2026-10-28

Public binary release is blocked. A successful application test does not resolve redistribution obligations. Keep the draft and local review archive private until the following evidence is complete. Components have not been silently removed to bypass these gates.

| Component | Exact observation / available notices | Remaining gate |
|---|---|---|
| Essentia | `essentia_streaming_extractor_music.exe`, 24,106,749 bytes; the supplied directory has no adjacent license or build provenance. Project build recipes are present. | Establish the binary's exact revision, dependencies, compiler/build recipe and applicable terms; provide matching source and notices. The generic repository alone does not establish correspondence. |
| FFmpeg | `6.1.1-essentials_build-www.gyan.dev`, GCC 12.2, `--enable-gpl --enable-version3 --enable-static`; supplied README identifies FFmpeg revision `e38092ef93`. GPLv3 license and build configuration are retained in the ffmpeg-static package. | Provide/verify the complete corresponding source and build scripts for FFmpeg **and statically linked dependencies**. The top-level revision link is useful but does not settle the complete bundle. |
| Sharp/native image libraries | Sharp 0.35.5; exact installed versions and package notices are retained in `server/node_modules` and the manifest. | Match native bundled library versions to source/build materials and verify applicable LGPL replacement/relinking and notice obligations. |
| NVIDIA CUDA | `cudart64_13.dll`, `cublas64_13.dll`, `cublasLt64_13.dll`; DLL hashes are in release-manifest.json. CUDA's distribution list includes these families, subject to its agreement. The local installed toolkit is 12.6, while these reused binaries are CUDA 13. | Establish exact supplier/version and applicable agreement/notices for these files; do not infer provenance from filenames or a locally installed different toolkit. |
| MSVC runtime | App-local msvcp140, msvcp140_1, vcruntime140, vcruntime140_1 and vcomp140 DLLs are retained and hashed. | Verify supplier/version, distributable-code listing and applicable licensed distribution terms. Presence of Visual Studio alone is not a complete provenance record. |
| C++ engine / GGML / plugins | Project engine license, cpp-httplib and AdamW8bit notices preserved. Engine EXEs/DLLs are reused unchanged from the earlier audited local runtime, not recompiled by this preparation. Git contains pinned external submodule references. Lua/plugin files are inventoried in FILE-MANIFEST.json. | Match the exact native executables/DLLs and any compiled plugins to source revisions, submodule contents, patches and build flags. Verify included plugin dependency notices. |
| Node / JS / UI | Node license, npm package notices and frontend third-party notices retained. Server/UI are rebuilt from the final public commit. | Native components above still block the aggregate Portable. |
| Models / user assets | Model weights and user music, images, accounts, DBs and private keys are not bundled. | Download separately under each model's terms; no blanket rights are claimed for imported material. |

Primary references checked for this review:

- [Essentia licensing and third-party dependencies](https://essentia.upf.edu/licensing_information.html)
- [FFmpeg legal and source guidance](https://ffmpeg.org/legal.html)
- [FFmpeg binary supplier](https://www.gyan.dev/ffmpeg/builds/) and [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static)
- [Sharp licensing](https://sharp.pixelplumbing.com/) and [sharp-libvips build/source repository](https://github.com/lovell/sharp-libvips)
- [NVIDIA CUDA EULA and distributable list](https://docs.nvidia.com/cuda/eula/index.html)
- [Microsoft Visual C++ redistribution guidance](https://learn.microsoft.com/en-us/cpp/windows/redistributing-visual-cpp-files?view=msvc-170)

These references are starting points for completing the evidence, not a claim that a license review has passed. Do not publish the Portable until all applicable gates and required tests are resolved.
