# SHS Music Studio

**Windows 음악 제작 Workspace와 다중 사용자 서버를 결합한 AI 음악 스튜디오입니다.** 서버의 GPU와 공용 모델을 함께 사용하면서, 계정별 음악·이미지·제작 초안을 관리합니다. Android에서는 같은 서버에 브라우저로 접속해 기존 모바일 UI를 사용합니다.

[SHS 저장소](https://github.com/Songssh/shs-music-studio) · [SHS 이슈](https://github.com/Songssh/shs-music-studio/issues) · [SHS Releases](https://github.com/Songssh/shs-music-studio/releases)

**버전: v0.1.0-preview 공개 후보.** 아래 기능은 이 README와 함께 제공하는 소스 기준입니다. Windows Portable은 로컬 검증 후보까지 준비되어 있으며 **다운로드 가능한 SHS Release는 아직 게시하지 않았습니다.** 서드파티 바이너리의 출처·라이선스·대응 소스 확인이 남아 있습니다.

SHS Music Studio는 [HOT-Step CPP](https://github.com/scragnog/HOT-Step-CPP) **v1.4.2**를 기반으로 한 독립 수정판입니다. 원본 저작권과 라이선스를 유지합니다. [원본 README 보관본](README-UPSTREAM.md)의 Discord·후원·다운로드는 원본 HOT-Step의 채널이며 SHS의 공식 배포나 지원 링크가 아닙니다.

## 소스에 포함된 기능

| 기능 | 구현 내용과 범위 |
|---|---|
| **Windows Workspace** | 도구 창의 도킹·탭·분리, 창 활성화, 키보드 조작, 사용자별 레이아웃·테마·배경 설정. 음악 제작 도구와 라이브러리를 같은 작업 공간에서 사용합니다. |
| **다중 사용자** | Better Auth 로그인, 일회성 초기 관리자 설정, 관리자/사용자 역할, Open·Invite·Closed 가입 정책, 초대·차단·관리자 비밀번호 재설정과 개인 DAW 키. |
| **개인 작업 데이터** | 음악·이미지·학습 자료·작업·초안에 소유권 검사를 적용하고 브라우저 저장 상태를 계정별로 분리합니다. |
| **공용 모델과 GPU** | 서버에 설치한 모델·GPU를 공용 자원으로 사용합니다. 모델 관리 권한과 개인 작업 권한을 나누고 생성·학습 작업을 공용 GPU 대기열에서 조율합니다. |
| **이미지 라이브러리** | 이미지 업로드, 원본·썸네일·화면용 변환, 자르기와 내보내기, 음악 표지·Workspace 배경 연결, 개인/공유 이미지 접근 제어. |
| **Windows Portable 실행 구조** | Node.js·서버·UI·네이티브 모듈·C++ 엔진을 묶는 빌드 도구, HTTPS, 앱/데이터 폴더 분리, 최초 설정, 정상 종료·재시작, 임시 데이터 검증 실행기. 배포 ZIP은 게시 전입니다. |
| **Android 브라우저 UI** | Windows Workspace 전환 없이 기존 모바일 화면을 유지합니다. 서버에 로그인하여 작업하며 모델과 GPU 처리는 서버에서 수행합니다. Android 네이티브 앱은 포함하지 않습니다. |

Windows 클라이언트는 Workspace를 기본으로 사용합니다. 모바일 화면을 유지하는 코드와 로컬 브라우저 검증은 있지만, Android 실기기의 모든 제작 흐름을 검증한 상태는 아닙니다.

## 기존 음악 제작 기능

원본 HOT-Step CPP의 다음 제작 도구를 유지합니다. 사용 가능한 모델과 기능은 설치한 모델·엔진·하드웨어에 따라 달라집니다.

- **AI 음악 생성**: ACE-Step 1.5, MiniMax-Music3, YuE2, Auto-Gen과 Custom-Gen.
- **곡 편집·재해석**: Cover와 Repaint, Lyric Studio, STORM.
- **학습·후처리**: Training Studio의 LoRA/LoKr, Stem 분리·믹서, MIDI Studio, 마스터링·VST3 후처리와 Lua 플러그인.
- **음악 관리**: 음악 라이브러리·재생·플레이리스트와 제작 초안.

[기능별 사용자 문서](docs/README.md)는 원본 기능 설명을 포함합니다. SHS의 설치·인증·서버 접속·업데이트는 이 README를 기준으로 하고, 원본의 배포 다운로드나 자동 업데이트 안내를 SHS에 적용하지 마세요.

## 미구현 개발 계획

다음 기능은 이번 소스와 Portable의 구현 완료 목록에 포함하지 않습니다. 일정은 정해지지 않았습니다.

| 계획 | 현재 상태 |
|---|---|
| **RVC** | 미구현. 음성 변환 엔진·모델 관리·UI 통합을 향후 검토합니다. |
| **HeartMuLa** | 미구현. 음악 모델 백엔드와 생성 흐름 통합을 향후 검토합니다. |
| **SHS 자동 업데이트·배포** | 미구현. SHS 전용 검증·게시 정책을 정한 뒤 도입합니다. 원본 GitHub Actions의 자동 실행은 SHS 저장소에서 제한합니다. |

## Windows Portable 설치와 첫 실행

**이 절은 SHS Portable이 게시된 뒤의 사용 방법입니다.** 현재는 [SHS Releases](https://github.com/Songssh/shs-music-studio/releases)에 다운로드 자산이 없습니다. 원본 HOT-Step ZIP을 SHS 배포본으로 대신 안내하지 않습니다.

Windows 10/11 x64의 쓰기 가능한 폴더를 사용합니다. 로컬 검증 후보는 CUDA 13 / x64이며, 호환 NVIDIA GPU 드라이버가 필요합니다. 다른 GPU·플랫폼 조합은 별도 검증 대상입니다.

1. SHS ZIP과 같은 릴리스의 `SHA256SUMS.txt`를 받습니다. PowerShell에서 아래 해시를 대조합니다.

   ```powershell
   Get-FileHash .\SHS-Music-Studio-v0.1.0-preview-win-x64-cuda.zip -Algorithm SHA256
   ```

2. ZIP을 완전히 풀고 `Setup.bat`를 실행합니다. 데이터 폴더와 HTTPS 주소를 지정합니다. 기본값은 앱 폴더 옆 `SHS-Music-Studio-Data`, `https://localhost:3443`입니다.
3. `SHS-Music-Studio.bat`를 실행합니다. 호환 실행기 `HOT-Step.bat`도 포함합니다.
4. 최초 관리자 설정에서 서버가 생성한 `<데이터>/library/auth-private/bootstrap-token`을 사용합니다. 설정 성공 후 토큰은 삭제됩니다. 공용 초기 계정이나 기본 비밀번호를 배포하지 않습니다.
5. Model Manager 또는 해당 모델의 이용 조건에 맞는 경로로 모델을 별도 설치합니다. 가중치는 ZIP에 포함하지 않습니다. 모델이 없어도 계정과 음악·이미지 관리 화면은 열 수 있습니다.
6. 종료는 앱의 종료 메뉴 또는 콘솔의 Ctrl+C를 사용합니다. 정상 종료가 서버가 시작한 엔진 프로세스를 함께 정리합니다.

Portable 실행에는 Node/npm/Python/Visual Studio를 따로 설치하지 않아도 됩니다. 외부 AI 제공자 기능은 별도의 서비스 계정·네트워크가 필요할 수 있습니다.

## 다른 PC와 Android에서 접속

기본 `localhost` 설정은 서버 PC용입니다. 다른 장치에서 사용하려면 Setup의 주소를 `https://music.example.com:3443`처럼 **접속 장치에서 해석할 수 있는 서버 DNS 이름**으로 정하고, Windows 방화벽에서 지정 TCP 포트의 허용 범위를 설정합니다. 이 설정은 외부 인터페이스에서 수신합니다. C++ 엔진은 loopback에서 수신합니다.

- **자체 서명 인증서**: 지정 주소용 인증서를 Setup에서 생성합니다. 지문을 확인한 뒤 각 PC·Android 클라이언트가 공개 인증서 `<데이터>/settings/tls/server.crt`를 신뢰하도록 설정해야 합니다. 신뢰 저장소를 자동 변경하지 않으며, `.key`/`.pfx` 개인키를 클라이언트에 공유하지 않습니다.
- **보유 인증서**: 아직 `portable.json`이 없는 새 앱 폴더에서 전체 체인 PEM과 개인키를 지정할 수 있습니다.

  ```powershell
  .\runtime\node.exe portable.mjs setup --yes --data-dir "D:\SHS-Music-Studio-Data" --url "https://music.example.com:3443" --cert "D:\cert\fullchain.pem" --key "D:\cert\privkey.pem"
  ```

- **HTTPS 역방향 프록시**: TLS를 처리하는 프록시가 있는 경우 다음과 같이 loopback 서버를 설정합니다.

  ```powershell
  .\runtime\node.exe portable.mjs setup --yes --data-dir "D:\SHS-Music-Studio-Data" --url "https://music.example.com" --proxy --port 3001
  ```

프록시는 원래 Host/Origin을 보존하고 `127.0.0.1:3001`로 전달합니다. PC와 Android에서 같은 HTTPS 주소에 로그인합니다. 모델·GPU는 서버에 두고, 계정별 개인 작업과 공용 자원을 함께 사용합니다.

## 데이터·업데이트·보안 범위

- 앱의 `portable.json`에는 경로·주소·포트·TLS 방식을 저장합니다. 별도 데이터 폴더의 `library`에는 DB·음악·이미지·인증 자료, `settings`에는 환경 설정·TLS, `models`/`adapters`에는 모델·LoRA가 있습니다. 이 실제 데이터와 계정·세션·키는 Git이나 배포 ZIP에 넣지 않습니다.
- 업데이트 전 서버를 종료하고 전체 데이터 폴더를 백업합니다. 새 SHS ZIP은 새 앱 폴더에 풀고 기존 데이터 경로에 연결합니다. 원본 자동 업데이트는 수정판을 덮어쓸 수 있어 사용하지 않습니다.
- `HOT_STEP_*`, 기존 DB/API 이름과 일부 HOT-Step UI 표시는 호환성을 위해 남아 있습니다.
- 이메일 인증·메일 비밀번호 복구는 제공하지 않습니다. 관리자 재설정을 사용합니다. STORM은 연결 종료 시 스트림을 중지하는 기존 동작을 유지합니다.
- 외부 보안 감사, 깨끗한 Windows VM, Android 실기기 전체 흐름, 모든 GPU/드라이버 조합을 검증한 제품은 아닙니다. 공개 서버 운영 전 인증서·방화벽·계정 정책·백업을 검토하세요.

## 개발과 검증

이 소스가 반영된 SHS 저장소에서 개발할 때:

```powershell
git clone --recurse-submodules https://github.com/Songssh/shs-music-studio.git
cd shs-music-studio
npm.cmd --prefix server ci
npm.cmd --prefix ui ci
npm.cmd --prefix release ci
npm.cmd --prefix server run typecheck
npm.cmd --prefix ui run build
```

Portable 빌드 기준은 Node 24.18.0입니다. C++ 빌드에는 Visual Studio C++ 도구와 선택한 CUDA/Vulkan SDK가 필요합니다. [엔진 문서](engine/README.md), [아키텍처](docs/dev/architecture.md), [.gitmodules](.gitmodules)를 확인하세요. 소스 ZIP에 submodule 내용이 포함되지 않은 경우 기록된 고정 revision을 따로 받아야 합니다.

```powershell
.\release\build-release.ps1 -Version 0.1.0-preview -Variant cuda -BuildBackend cuda
```

`Start-Workspace.*`와 `tools/workspace/`는 별도 `../auth-environment/runtime`과 개발 `.env`를 요구하는 개발 도구입니다. 일반 사용자는 게시된 Portable 실행기를 사용합니다. 개발용 계정·세션 파일은 제공하지 않습니다.

기존 로컬 공개 후보에서 서버 타입 검사, UI/서버 빌드, 인증·소유권·이미지·경로·키보드 테스트 **17개**, Portable 실행 검사 **16개**를 통과했습니다. `Verify.bat`는 포함된 Node와 임시 데이터·임의 비밀번호로 HTTPS, 계정, 이미지, 재시작과 종료를 검사합니다. 이 결과는 실제 모델 생성·학습이나 깨끗한 PC 검증을 대신하지 않습니다.

## 원본·라이선스

원본 HOT-Step CPP와 기여자의 MIT [LICENSE](LICENSE), [엔진 라이선스](engine/LICENSE), vendored 코드와 개별 의존성의 고지를 보존합니다. SHS라는 이름 변경은 원저작권이나 외부 구성요소의 라이선스를 대체하지 않습니다.

[THIRD_PARTY.md](THIRD_PARTY.md)에 Essentia, FFmpeg/Sharp, CUDA/MSVC, 엔진 바이너리 출처와 대응 소스 제공의 미해결 항목을 기록했습니다. 해당 항목을 해결하기 전 바이너리 Release를 게시하지 않습니다. [미리보기 릴리스 설명](docs/publication/v0.1.0-preview.md)은 게시 전 초안입니다.
