import type { StoryUri } from '@storyboard/story-engine';
import * as vscode from 'vscode';

// NOTE: vscode.workspace.fs.writeFile은 자르고 쓰기라 중간에 죽으면 잘린 파일이 남는다. 초안은
// 재생성 비용이 큰 원전인데, 잘린 초안은 frontmatter가 닫히지 않아 원고 조립에서 통째로
// 누락된다(경고 로그만 남는다). 임시 파일에 쓴 뒤 바꿔치기해 파일이 옛 내용이거나 새 내용이거나
// 둘 중 하나만 되게 한다. CLI의 NodeFileSystem도 같은 규칙이다.
export async function writeFileAtomically(uri: StoryUri, content: Uint8Array): Promise<void> {
  const target = uri as vscode.Uri;
  const temporary = target.with({ path: `${target.path}.tmp-${Date.now().toString(36)}` });

  try {
    await vscode.workspace.fs.writeFile(temporary, content);
    await vscode.workspace.fs.rename(temporary, target, { overwrite: true });
  } catch (error) {
    try {
      await vscode.workspace.fs.delete(temporary);
    } catch {
      // 임시 파일이 만들어지지 않았으면 지울 것도 없다.
    }
    throw error;
  }
}
