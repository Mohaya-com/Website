import type { MaintenanceDTO } from '@vms/shared';
import type { Tone } from './ui/primitives';

export const MAINTENANCE_TONE: Record<MaintenanceDTO['status'], Tone> = { open: 'amber', in_progress: 'blue', done: 'green', cancelled: 'slate' };
