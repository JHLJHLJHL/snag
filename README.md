# snag

크롬에서 발견한 공개 영상을 드래그하여 다운로드 대기열에 추가하는 Windows 앱입니다. 데스크톱 본체·큐·파일 저장·크롬 통신은 **Rust + Tauri 2**, 화면은 React + Astryx로 구현했습니다. 사이트 분석과 미디어 처리는 yt-dlp·FFmpeg·Deno를 사용합니다.

## 실행

Windows 10/11 x64와 Microsoft Edge WebView2 Runtime이 필요합니다. 배포 폴더에서는 `SNAG(beta).exe`를 실행하세요. 실행 파일과 함께 있는 `engine`, `extension` 폴더를 유지해야 합니다.

소스에서 실행하려면 Node.js 22.12 이상, Rust stable MSVC, Visual Studio C++ 빌드 도구와 Windows SDK가 필요합니다.

```powershell
npm install
npm run setup:engine
npm run dev
```

엔진 준비는 공식 yt-dlp 릴리스 실행 파일을 SHA256으로 검증하여 다운로드하고, 설치된 FFmpeg·FFprobe를 복사합니다. FFmpeg가 없다면 yt-dlp 권장 FFmpeg 빌드를 받습니다. Deno도 공식 배포본에서 다운로드합니다. 최초 실행과 빌드 준비에는 인터넷이 필요합니다. 로그인·쿠키는 가져오지 않습니다.

## 크롬 연결

1. 앱의 **크롬 연결 → 크롬 연결 등록**을 누릅니다. 현재 사용자 계정의 `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.streamdrop.desktop`에 연결을 등록하며 관리자 권한은 필요하지 않습니다.
2. 크롬에서 `chrome://extensions`를 열고 **개발자 모드**를 켭니다.
3. **압축해제된 확장 프로그램을 로드합니다**에서 앱에 표시된 `extension` 폴더를 선택합니다.
4. 영상 페이지를 새로고침하고 영상을 재생합니다. 툴바의 snag에서 감지 목록을 확인하거나, 우클릭 메뉴의 **snag 대기열에 추가**를 사용합니다.

영상 페이지에 나타나는 **영상 잡아서 snag로** 버튼, 영상 링크 또는 썸네일을 앱이나 작은 드롭 창으로 끌어다 놓을 수도 있습니다. 플레이어마다 기본 드래그 지원이 달라서 확장 버튼·우클릭·URL 붙여넣기를 함께 제공합니다. 한 페이지에 영상이 여러 개면 확장 프로그램 감지 목록에서 선택하세요.

앱은 크롬 메시지를 받을 때 실행 중이어야 합니다. 앱 폴더를 이동하거나 다른 빌드로 바꾸었다면 **크롬 연결 다시 등록**을 누르세요. 연결 해제는 크롬 확장 프로그램을 제거하고 위 레지스트리 키만 삭제하면 됩니다.

## 다운로드

- 영상 추가 → 자동 분석 → 오른쪽에서 화질·음질 선택 → **이 영상 다운로드** 또는 **모두 다운로드**.
- 재생목록 주소를 붙여넣거나 끌어다 놓으면 포함된 영상을 원래 순서대로 대기열에 추가합니다. 이미 등록된 영상과 확인된 비공개·삭제 항목은 제외하고 추가 결과를 표시합니다. **모두 다운로드**로 전체 목록을 순서대로 저장할 수 있으며, 영상·음성 기본 설정도 동일하게 적용됩니다.
- 대기열의 체크박스로 항목을 고른 뒤 **영상 다운**(MP4) 또는 **음성 다운**(MP3)으로 선택 항목의 설정을 일괄 변경합니다. 설정 버튼은 다운로드를 시작하지 않으며, 체크 상태가 유지됩니다. 실제 저장은 오른쪽 하단의 **선택한 N개 다운로드**를 눌러 시작합니다. 전체 선택·해제를 지원하며 **제거**는 선택 항목을 목록에서만 제외합니다. 진행 중인 다운로드는 선택 대상에서 제외됩니다. 대기열과 완료 목록은 주소 입력·선택 행을 고정하고 목록만 스크롤합니다.
- 원본 최고 화질, 최대 1080p/720p/480p 프리셋과 사이트가 제공하는 실제 포맷을 고를 수 있습니다.
- 다운로드 형태는 **영상**, **음성** 두 가지입니다. 음성은 기본 MP3로 저장하며 출력 음질을 고를 수 있습니다. 음질은 실제 제공되는 트랙·언어·비트레이트를 기준으로 선택합니다.
- `원본 유지`는 코덱 재인코딩을 피합니다. 분리된 영상·음성은 MKV 컨테이너로 병합할 수 있습니다. MP4 선택 시 필요한 경우 변환합니다.
- 한 번에 한 개씩 다운로드하며, 순서 변경·일시 정지·취소·재시도·주소 기준 중복 방지를 지원합니다.
- 완료 목록에서 항목을 체크한 뒤 **삭제**를 누르면 **삭제할까요?** 확인창이 열립니다. 기본값은 기록만 삭제이며, **파일도 함께 삭제**를 체크하면 실제 파일도 휴지통으로 이동하지 않고 삭제합니다. 파일 삭제에 실패한 항목은 목록에 남고 확인창에서 재시도하거나 기록만 정리할 수 있습니다.
- 큐는 `%LOCALAPPDATA%\com.streamdrop.desktop\queue.json`에 자동 저장합니다. 재실행 시 중단 작업은 일시 정지 상태로 복구됩니다. 이어받기는 서버·프로토콜·원본 주소의 유효성에 따라 달라집니다.
- 다운로드·변환은 저장 폴더의 `.streamdrop` 작업 공간에서 진행한 뒤 완료 파일을 내보냅니다. 중단 파일은 이어받기를 위해 유지합니다. 필요 없는 중단 작업을 정리할 때는 관련 큐를 비운 뒤 해당 작업 공간을 직접 정리할 수 있습니다.
- 대기열이 비어 있을 때 오른쪽 **다운로드 설정**에서 앞으로 추가할 영상·재생목록의 기본 품질을 고를 수 있습니다. 저장 폴더는 하단의 **저장 폴더 변경**에서 바꿉니다. 기본값은 직접 시작입니다.

## 지원 범위

공개 HTTP(S) 영상 파일과 DRM 없는 HLS·DASH, yt-dlp가 분석할 수 있는 사이트 영상과 재생목록을 대상으로 합니다. 모든 사이트의 작동을 보장하지 않습니다. 로그인·쿠키 가져오기·DRM 보호 해제·실시간 방송은 지원하지 않습니다. 목록 확인 뒤 개별 분석에서 접근 제한이 확인되는 영상은 해당 항목에 오류를 표시하며 나머지 다운로드는 계속 진행합니다. 화질 선택은 원본이 제공할 때만 가능하며 변환으로 원본 품질이 높아지지 않습니다. 만료된 미디어 주소는 페이지에서 영상을 다시 재생하여 새로 추가해야 할 수 있습니다.

확장 프로그램은 HTTP(S) 페이지에서 영상 요소와 미디어 요청 주소를 감지합니다. `cookies` 권한이 없으며 인증 헤더·브라우저 로그인 데이터를 다운로드 엔진에 전달하지 않습니다. Native Messaging 연결은 확장 ID로 제한되고, 로컬 큐 서버는 임의 포트의 127.0.0.1에서 토큰 인증을 요구하며 웹페이지 Origin 요청을 거부합니다.

## 테스트와 빌드

```powershell
npm test                 # Rust core/queue/native protocol tests
npm run test:motion      # 상태 전환·드롭·미디어 선택·복사·모션 감소 UI 검증
npm run test:engine      # 실제 MP4·HLS·MP3·재생목록 다운로드 + FFprobe 검증
npm run build            # React production bundle
npm run test:e2e         # 실제 Tauri/WebView2 + 네이티브 브리지 + 큐/품질/드롭 창
npm run test:extension   # 별도 Chrome for Testing 프로필에서 실제 확장·네이티브 통신
npm run package          # Rust release + portable folder/ZIP
```

`test:e2e`는 테스트 전용 데이터 폴더와 WebView2 프로필을 사용합니다. 테스트 아티팩트는 `.test-artifacts`에 저장되며 실제 브라우저 로그인 프로필을 읽지 않습니다. `npm start`는 준비된 실행 파일을 실행합니다.

`test:motion`은 별도 Vite 서버와 테스트 전용 Tauri IPC 픽스처로 렌더러를 검증합니다. 실제 다운로드·파일 저장·네이티브 통신은 `test:e2e`에서 검증합니다. UI는 링크 드롭 반응, 작업 중→완료 전환, 단계별 진행 표시, 미디어 선택 전환, 작은 드롭 창의 상태 변화, 경로 복사 확인을 제공합니다. 모션은 실제 작업 상태에 연결되며 Windows의 모션 감소 설정을 따릅니다.

`test:extension`은 `npx playwright install chromium`으로 준비한 Chrome for Testing을 사용합니다. 테스트 전용 native host 키 `com.streamdrop.smoketest`를 만들고 종료 시 제거합니다. 사용 중인 크롬 프로필이나 앱의 실제 연결 키는 변경하지 않습니다.

`scripts/rust.mjs`는 일반 설치된 Rust/MSVC 환경을 사용합니다. `STREAMDROP_MSVC`가 설정되었거나 이 작업에서 준비한 `%TEMP%\streamdrop-tools\msvc`가 있으면 해당 로컬 컴파일러/SDK를 사용합니다. 앱을 실행할 사용자에게 Rust나 Node 설치는 필요하지 않습니다.

## 구성

| 경로 | 역할 |
|---|---|
| `src-tauri/src/model.rs` | 입력 검증·포맷·품질 선택 |
| `src-tauri/src/queue.rs` | 큐 상태와 취소·재시도·순서 |
| `src-tauri/src/store.rs` | 원자적 JSON 저장·중단 복구 |
| `src-tauri/src/engine.rs` | yt-dlp/FFmpeg 프로세스와 진행률 |
| `src-tauri/src/bridge.rs` | 크롬 프레이밍·인증된 로컬 통신 |
| `src-tauri/src/desktop.rs` | Tauri 명령·네이티브 창·폴더 선택 |
| `src/` | React/Astryx 화면 |
| `extension/` | Manifest V3 확장 프로그램 |

제3자 엔진의 라이선스와 소스: [yt-dlp](https://github.com/yt-dlp/yt-dlp), [FFmpeg](https://ffmpeg.org/legal.html), [사용한 Windows FFmpeg 배포](https://www.gyan.dev/ffmpeg/builds/), [Deno](https://github.com/denoland/deno). 번들에는 해당 엔진의 고지와 버전 정보를 함께 제공합니다.
