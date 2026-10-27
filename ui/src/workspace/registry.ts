// One registry drives the launcher, taskbar, personalization and desktop menu.
export const WINDOWS = [
  ['create','음악 생성 · Custom-Gen','♫','음악 생성','가사와 프롬프트로 음악을 생성합니다.'],
  ['insta-gen','자동 생성 · Auto-Gen','✦','음악 생성','아이디어부터 완성곡까지 자동으로 진행합니다.'],
  ['storm','STORM','ϟ','음악 생성','실시간 스트리밍 음악을 만듭니다.'],
  ['library','내 음악 · Library','▦','라이브러리','보유곡을 찾고 재생·관리합니다.'],
  ['images','내 이미지 · Images','▧','라이브러리','커버와 배경을 하나의 원본으로 관리합니다.'],
  ['details','곡 상세 · Details','ⓘ','라이브러리','선택한 곡의 가사와 정보를 확인합니다.'],
  ['playlist','플레이리스트 · Playlist','☷','라이브러리','음악을 모아 연속 재생합니다.'],
  ['stem-studio','음원 분리 · Stem Separator','♬','편집·분리','음원을 개별 스템으로 분리합니다.'],
  ['cover-studio','커버 편집 · Cover Studio','◈','편집·분리','기존 음악을 새로운 스타일로 만듭니다.'],
  ['repaint','구간 편집 · Repaint','◩','편집·분리','음악의 선택 구간을 다시 생성합니다.'],
  ['lyric-studio','가사 작업 · Lyric Studio','✎','편집·분리','가사와 앨범별 생성 작업을 관리합니다.'],
  ['compare-studio','비교 · Compare','⇄','편집·분리','음원을 A/B로 비교해 들어봅니다.'],
  ['song-builder','곡 구성 · SongBuilder','▤','편집·분리','여러 구간을 하나의 곡으로 조합합니다.'],
  ['stem-builder','스템 구성 · StemBuilder','▥','편집·분리','스템을 조합하고 믹스합니다.'],
  ['midi-studio','MIDI Studio','♮','편집·분리','MIDI 변환과 악보 작업을 진행합니다.'],
  ['training-studio','학습 · Training','◇','학습','데이터셋과 모델 학습을 관리합니다.'],
  ['queue','작업 큐 · Queue','≡','설정·관리','실행 중이거나 대기 중인 작업을 확인합니다.'],
  ['assistant','Assistant','✧','설정·관리','음악 작업을 도와주는 대화를 이어갑니다.'],
  ['parameters','모델·생성 설정 · Parameters','⚙','설정·관리','엔진과 생성 매개변수를 조정합니다.'],
  ['settings','설정 · Settings','⚙','설정·관리','앱 설정과 환경을 관리합니다.'],
  ['model-manager','Model Manager','▣','설정·관리','설치된 모델과 다운로드를 관리합니다.'],
  ['terminal','터미널 · Terminal','›_','설정·관리','서버 로그를 확인합니다.'],
  ['account','내 계정 · Account','◎','설정·관리','프로필, 통계, 개인화 및 연결을 관리합니다.'],
] as const;
export type WindowId = typeof WINDOWS[number][0];
export const windowTitle = (id:string) => WINDOWS.find(w=>w[0]===id)?.[1]??id;
export const isWindowId = (id:string):id is WindowId => WINDOWS.some(w=>w[0]===id);
export function isWindowsClient(userAgent:string,platform='') {
  return !/Android|iPhone|iPad|iPod/i.test(userAgent)&&/Windows|Win32|Win64/i.test(`${userAgent} ${platform}`);
}
export const LAYOUT_KEY='hs-workspace-windows-v1';
export const SAVED_LAYOUT_KEY='hs-workspace-windows-saved-v1';
