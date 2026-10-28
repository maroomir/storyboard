import type { CommandHandler } from './outcome';
import { SimReport } from '@/commands/sim/simReport';
import { SimRunner } from '@/commands/sim/simRunner';

export const runSim: CommandHandler = async (context) => await new SimRunner(context).run();

export const screenSim: CommandHandler = async (context) => await new SimRunner(context).screen();

export const sweepSim: CommandHandler = async (context) => await new SimRunner(context).sweep();

export const reportSim: CommandHandler = async (context) => await new SimReport(context).report();

export const rejudgeSim: CommandHandler = async (context) => await new SimRunner(context).rejudge();

export const applySim: CommandHandler = async (context) => await new SimReport(context).apply();
