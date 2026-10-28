import { syncBoard } from '../../lib/board.mjs';

// 매시 정각 클라라 → 칸반 동기화
export default async () => {
  const b = await syncBoard('schedule');
  console.log('sync', b.lastSync, b.lastSyncCount, b.lastError?.message || 'ok');
};

export const config = { schedule: '@hourly' };
