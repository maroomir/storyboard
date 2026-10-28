import type { ICommandHandler } from '@/commands/commandHandler';
import type { CommandContext, CommandOutcome } from '@/commands/outcome';
import type { CommandSpec } from '@/commands/catalog';
import { DoctorSection, renderDoctorLine, renderDoctorPanels } from '@/commands/doctorViews';
import type { DoctorCheck } from '@/commands/doctorCheck';
import { DoctorChecks } from '@/commands/doctorChecks';
import { existsSync } from 'fs';
import type { StoryboardHomePaths } from '@storyboard/story-config';

export class DoctorCommand implements ICommandHandler {
  public readonly spec: CommandSpec = {
    verb: 'doctor',
    group: '시작하기',
    usage: 'doctor',
    summary:
      '설정 파일·프로바이더·API 키·CLI 실행 파일과 로그인·워크스페이스·이야기 상태 원장을 점검합니다 (init --repair 로 보수)',
    examples: ['storyboard doctor', 'storyboard doctor --json'],
    needsWorkspace: false,
  };

  public async execute({ container, stdout }: CommandContext): Promise<CommandOutcome> {
    const checks: DoctorChecks = new DoctorChecks(container);
    const home: StoryboardHomePaths = container.homePaths;
    const hasUserConfig: boolean = existsSync(home.configFile);
    const workspaceConfig: string | undefined = container.workspaceConfigFile;
    const homeChecks: DoctorCheck[] = [
      { status: 'info', label: 'Storyboard 홈', detail: home.home },
      {
        status: hasUserConfig ? 'ok' : 'info',
        label: '공통 설정',
        detail: hasUserConfig ? home.configFile : `${home.configFile} (아직 없음)`,
      },
      ...(workspaceConfig !== undefined && existsSync(workspaceConfig)
        ? [{ status: 'ok' as const, label: '이 작품 설정', detail: workspaceConfig }]
        : []),
    ];
    const nodeCheck: DoctorCheck = { status: 'info', label: 'Node', detail: process.version };
    const sections: DoctorSection[] = [
      { title: '환경', checks: [...homeChecks, nodeCheck] },
      { title: 'AI', checks: await checks.provider() },
      { title: '리소스 파일', checks: await checks.resources() },
      { title: '작품', checks: await checks.workspace() },
    ];
    const allChecks: DoctorCheck[] = [
      ...homeChecks,
      ...sections.slice(1).flatMap((section) => section.checks),
      nodeCheck,
    ];

    const isDrawn: boolean = stdout?.isTty === true;

    return {
      ok: !allChecks.some((check) => check.status === 'fail'),
      message:
        isDrawn && stdout !== undefined
          ? renderDoctorPanels(sections, stdout).join('\n')
          : allChecks.map(renderDoctorLine).join('\n'),
      data: { checks: allChecks },
      isDrawn,
    };
  }
}
