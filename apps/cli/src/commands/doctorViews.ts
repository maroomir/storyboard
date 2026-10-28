import type { DoctorCheck } from '@/commands/doctorCheck';
import type { ThemeRole } from '@/terminal/theme';
import type { TerminalStream } from '@/terminal/profile';
import { measureWidth } from '@/terminal/width';
import { renderBox, renderColumns, type ColumnRow } from '@/terminal/layout';

export function statusIcon(status: DoctorCheck['status']): string {
  switch (status) {
    case 'ok':
      return '✅';
    case 'warn':
      return '⚠️';
    case 'fail':
      return '❌';
    case 'info':
      return 'ℹ️';
  }
}

export interface DoctorSection {
  readonly title: string;
  readonly checks: readonly DoctorCheck[];
}

export function renderDoctorLine(check: DoctorCheck): string {
  const fix: string = check.fix ? `\n     → ${check.fix}` : '';
  return `${statusIcon(check.status)} ${check.label}: ${check.detail}${fix}`;
}

export const doctorMarks: Readonly<
  Record<DoctorCheck['status'], readonly [mark: string, role: ThemeRole]>
> = {
  ok: ['✓', 'success'],
  warn: ['▲', 'warning'],
  fail: ['✗', 'danger'],
  info: ['·', 'muted'],
};

export const doctorPanelWidth: number = 100;

export function renderDoctorPanels(
  sections: readonly DoctorSection[],
  stream: TerminalStream,
): string[] {
  const { paint } = stream.theme;
  const visibleSections: DoctorSection[] = sections.filter((section) => section.checks.length > 0);
  const allChecks: DoctorCheck[] = visibleSections.flatMap((section) => section.checks);
  const innerWidth: number = Math.min(stream.columns, doctorPanelWidth) - 4;
  const labelWidth: number = Math.max(...allChecks.map((check) => measureWidth(check.label))) + 2;

  const describeCheck = (check: DoctorCheck): ColumnRow => {
    const [mark, role] = doctorMarks[check.status];
    const fix: string = check.fix === undefined ? '' : `\n${paint('muted', `→ ${check.fix}`)}`;
    return { label: `${paint(role, mark)} ${check.label}`, description: `${check.detail}${fix}` };
  };

  const panels: string[] = visibleSections.flatMap((section) =>
    renderBox(
      renderColumns(section.checks.map(describeCheck), {
        availableWidth: innerWidth,
        indent: 0,
        labelWidth,
      }),
      {
        availableWidth: stream.columns,
        innerWidth,
        title: section.title,
        paintFrame: (text) => paint('muted', text),
        paintTitle: (text) => paint('heading', text),
      },
    ),
  );

  const count = (status: DoctorCheck['status']): number =>
    allChecks.filter((check) => check.status === status).length;
  const summary: string = [
    paint('success', `통과 ${count('ok')}`),
    paint('warning', `경고 ${count('warn')}`),
    paint('danger', `실패 ${count('fail')}`),
  ].join(paint('muted', ' · '));
  const firstFix: DoctorCheck | undefined =
    allChecks.find((check) => check.status === 'fail' && check.fix !== undefined) ??
    allChecks.find((check) => check.status === 'warn' && check.fix !== undefined);

  return [
    ...panels,
    ` ${summary}`,
    ...(firstFix?.fix === undefined ? [] : [` ${paint('muted', '먼저 →')}  ${firstFix.fix}`]),
  ];
}
