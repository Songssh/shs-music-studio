# Third-party notices and redistribution review

SHS Music Studio is based on HOT-Step CPP v1.4.2 (82945e027cfce38602768fdb323236808d47f5bb). The original MIT license and copyright notices are retained without replacement. The project name does not relicense dependencies.

| Component | Preserved notice / source | Publication status |
|---|---|---|
| HOT-Step CPP | LICENSE; https://github.com/scragnog/HOT-Step-CPP | Original MIT copyright retained |
| acestep.cpp engine | engine/LICENSE | Original MIT copyright retained |
| cpp-httplib | engine/vendor/cpp-httplib/LICENSE | Preserve vendored license |
| AdamW8bit CUDA implementation | engine/src/train/adamw8bit_cuda_LICENSE.txt; tools/yue2-aitk-reference/adamw8bit_cuda_LICENSE.txt | Preserve both notices |
| MusicXML fixtures | ui/src/components/cover-studio/musicxml/fixtures/MUSICXML_TEST_SUITE_LICENSE.txt | Preserve fixture license |
| GGML / VST3 SDK | .gitmodules and pinned gitlinks; https://github.com/scragnog/HOT-ggml ; https://github.com/steinbergmedia/vst3sdk | Initialize pinned submodules for builds; binary-to-source correspondence still to verify |
| Node.js | runtime/Node-LICENSE.txt in Portable | Original bundled Node notices retained |
| Server npm dependencies | server/package-lock.json and server/node_modules in Portable | Package licenses retained; inventory in release-manifest.json |
| UI dependencies (including Dockview) | ui/package-lock.json; THIRD-PARTY-NOTICES.txt in Portable | Original notices retained |
| Sharp / libvips | Package notices under server/node_modules/@img and sharp | Verify LGPL source/relinking obligations for the exact native build before publishing |
| FFmpeg | server/node_modules/ffmpeg-static/LICENSE, ffmpeg.exe.LICENSE and ffmpeg.exe.README | GPL-enabled binary: provide exact corresponding source/build information before Release publication |
| Essentia | https://essentia.upf.edu/licensing_information.html ; https://github.com/MTG/essentia | Existing binary has no adjacent license/provenance in this checkout; excluded from new source snapshot, retained in local Portable review candidate only; Release blocked pending complete notices/source or replacement |
| NVIDIA CUDA runtime | Exact runtime DLL hashes in release-manifest.json | Confirm applicable redistributable terms and ship applicable notices for the actual version before Release publication |
| Microsoft Visual C++ runtime | App-local DLL hashes | Confirm redistributable provenance/license and required notices before Release publication |

The existing Portable archive reuses C++ executables from an earlier local official-engine distribution. This preparation rebuilds the TypeScript server and UI; it does not claim to rebuild the C++ engine or certify the origin of those binaries.

The local preview candidate is a review artifact, not a legal clearance or a published Release. Keep the binary release on hold until the entries above are resolved. A generic repository link alone does not establish that the source corresponds exactly to the shipped executable. FFmpeg's primary guidance explains build-dependent licensing and corresponding source requirements: https://ffmpeg.org/legal.html. The ffmpeg-static package describes its binary suppliers: https://github.com/eugeneware/ffmpeg-static.

Model weights, user music/images, accounts, databases, authentication keys and certificates are not part of the public source or Portable archive. Model and sample assets retain their own licenses; users must obtain rights to material they import or redistribute.
