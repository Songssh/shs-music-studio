SHS Music Studio v0.1.0-preview — Windows Portable (x64)
Based on HOT-Step CPP v1.4.2; upstream copyrights and licenses are preserved.

실행 (Windows 10/11 x64)
1. ZIP을 쓰기 가능한 폴더에 완전히 압축 해제합니다.
2. Setup.bat 실행: 별도 데이터 경로와 HTTPS 주소를 입력합니다.
   기본값: ../SHS-Music-Studio-Data, https://localhost:3443
3. SHS-Music-Studio.bat 실행 (HOT-Step.bat도 호환 유지). 브라우저의 최초 설정에서 관리자 계정을 만듭니다.
   초기 토큰은 <데이터>/library/auth-private/bootstrap-token 파일에 있습니다.
   이 파일은 서버 첫 실행 때 생성되며 관리자 설정 완료 후 삭제됩니다.
   암호는 12자 이상입니다. 비밀 파일을 다른 사람에게 보내지 마세요.
4. 종료는 앱의 종료 메뉴 또는 실행 창에서 Ctrl+C를 사용합니다.
   창을 강제로 닫지 않으면 서버가 소유한 엔진 프로세스도 함께 정리합니다.

Node.js, npm, Python, Visual Studio 설치는 필요 없습니다.
Node 24, Better Auth, Kysely, SQLite 네이티브 애드온, Sharp/libvips,
FFmpeg, 컴파일된 UI(이미지 편집/Workspace 라이브러리 포함), C++ 엔진,
앱 로컬 MSVC DLL을 포함합니다. CUDA 패키지는 CUDA 런타임도 포함하며
호환 NVIDIA GPU 드라이버는 PC에 설치되어 있어야 합니다.
모델 가중치는 포함하지 않습니다. 모델이 없어도 서버/계정/음악/이미지
관리 화면은 실행되며 생성에는 Model Manager에서 받거나 별도로 옮긴
모델이 필요합니다. 외부 AI/API 제공자 기능에는 별도 계정/네트워크가 필요합니다.

HTTPS
- 기본 인증서는 이 PC의 지정 주소용 자체 서명 인증서입니다(1년).
  브라우저 경고 없이 사용하려면 인증서 지문을 확인하고 해당 클라이언트에서
  <데이터>/settings/tls/server.crt를 신뢰해야 합니다. 자동 등록하지 않습니다.
  예: certutil -user -addstore Root "D:\SHS-Music-Studio-Data\settings\tls\server.crt"
  이 명령은 현재 Windows 사용자의 신뢰 저장소를 변경합니다.
  공개 인증서(.crt)만 클라이언트로 옮기며 .pfx/.key는 공유하지 않습니다.
- 다른 PC 접속은 Setup의 주소를 https://서버의DNS이름:3443 으로 정합니다.
  이 경우 모든 네트워크 인터페이스에서 수신합니다. Windows 방화벽에서
  해당 TCP 포트의 허용 범위를 직접 설정합니다. 엔진 포트는 loopback입니다.
- 보유 인증서(전체 체인 PEM + 개인키): 설정 파일이 없는 새 앱 폴더에서
  runtime\node.exe portable.mjs setup --yes --data-dir "D:\SHS-Music-Studio-Data" --url "https://music.example.com:3443" --cert "D:\cert\fullchain.pem" --key "D:\cert\privkey.pem"
- 별도 HTTPS 역방향 프록시가 있는 경우:
  runtime\node.exe portable.mjs setup --yes --data-dir "D:\SHS-Music-Studio-Data" --url "https://music.example.com" --proxy --port 3001
  프록시는 원래 Host/Origin을 유지하고 127.0.0.1:3001로 전달합니다.
  이 모드에서는 자체 TLS 수신기가 없으며 프록시의 TLS가 필수입니다.
- 인증서를 갱신하려면 서버 종료 후 settings/tls의 해당 파일을 교체하고
  재시작합니다. 자체 서명 주소를 바꾸면 같은 폴더의 인증서도 다시 생성해야 합니다.
  runtime\node.exe / Setup.bat는 OpenSSL을 요구하지 않습니다.

데이터와 업그레이드
portable.json: 이 앱이 사용할 데이터 위치, 주소, 포트, TLS 방식.
<데이터>/library: hotstep.db, 음악, 이미지, 학습 데이터, auth-private.
<데이터>/models, adapters: 공유 모델/LoRA.
<데이터>/settings: .env(기타 서버 설정), tls(비공개 인증서/키).
<데이터>/profile, logs, tools, cache, tmp: 포인터, 로그, 다운로드/임시 파일.
TLS와 auth-private는 설정한 Windows 계정 및 SYSTEM만 접근하도록 제한합니다.
다른 Windows 계정으로 실행할 때는 데이터 폴더 ACL도 검토해야 합니다.

새 버전은 다른 앱 폴더에 풀고 기존 portable.json을 복사하거나 Setup에서
같은 데이터 경로를 선택합니다. 상대 경로는 앱 폴더 기준입니다.
전체 데이터 폴더를 서버 종료 후 백업하세요. 앱 폴더만 삭제해도 데이터는
남습니다. 데이터 이동은 서버 종료 후 폴더를 옮기고 portable.json을 수정합니다.
이 실행기는 명시적 데이터 경로를 고정하므로 앱 내 데이터 이동은 비활성화됩니다.
기존 개발/운영 DB나 모델은 이 배포에 복사하지 않았습니다.
수정판을 유지하려면 공식 원본의 자동 업데이트 대신 새 수정판 ZIP으로 교체하세요.

검증
Verify.bat는 포함된 Node와 임시 데이터 폴더로 이 PC에서 검증합니다.
기존 사용자 데이터는 사용하지 않습니다. SQLite, Sharp, FFmpeg, 인증서,
HTTPS, 최초 관리자, 로그인, 이미지 변환, Workspace 배경, 엔진 시작,
재시작 후 데이터 유지와 종료를 확인합니다. 결과 JSON/로그 경로를 출력합니다.
개발 도구 PATH를 제거한 로컬 검증이며 깨끗한 Windows VM 검증은 아닙니다.
실제 모델 추론, 드라이버 설치, 외부 AI 제공자의 작동을 대신 검증하지 않습니다.

빌드 기록: release-manifest.json (버전/엔진 SHA256/잠금 의존성 목록).
라이선스: LICENSE, runtime/Node-LICENSE.txt, server/node_modules의 각 패키지.

공개 검토 후보: THIRD_PARTY.md 및 RELEASE-NOTES.md의 미해결 재배포 조건을 먼저 확인하세요.
