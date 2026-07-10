import type { GoogleServiceSchema } from '@/app/features/google/schemas';
import type { z } from 'zod';

export type GoogleService = z.infer<typeof GoogleServiceSchema>;
