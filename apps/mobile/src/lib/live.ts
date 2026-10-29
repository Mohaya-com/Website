import { createContext, useContext } from 'react';
import type { LiveStatus } from './realtime';

export const LiveContext = createContext<LiveStatus>('connecting');
export const useLiveStatus = () => useContext(LiveContext);
