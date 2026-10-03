import { STORYBOARD_FILE_EXTENSIONS, STORYBOARD_RELATIVE_PATHS } from '@storyboard/story-model';

// 여러 명령이 똑같이 내는 안내 문구. 파일마다 적어 두면 워크스페이스 규칙이 바뀌었을 때 일부만
// 고쳐져 사용자가 서로 다른 경로를 안내받는다. 경로와 확장자는 story-model 의 표에서 온다.
const outlineFileName = STORYBOARD_RELATIVE_PATHS.outlineChapters.split('/').at(-1);

export const storyboardMessages = {
  missingWorkspace: `Storyboard 프로젝트(${STORYBOARD_RELATIVE_PATHS.projectJson})가 없습니다. 먼저 초기화해 주세요.`,
  missingWorkspaceFolder: `Storyboard 프로젝트(${STORYBOARD_RELATIVE_PATHS.projectJson})가 있는 워크스페이스 폴더가 없습니다.`,
  missingOutline: `아웃라인(${outlineFileName})이 없습니다. 먼저 Generate Novel Outline을 실행해 주세요.`,
  missingSceneUri: `씬 파일 URI가 없습니다. \`${STORYBOARD_RELATIVE_PATHS.sceneDirectory}\` 폴더의 \`${STORYBOARD_FILE_EXTENSIONS.card}\` 파일을 열거나 탐색기에서 명령을 실행해 주세요.`,
} as const;
