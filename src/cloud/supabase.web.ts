import type { SupabaseClient } from '@supabase/supabase-js';

import { CloudError } from './types';

export function getSupabase(): SupabaseClient {
  throw new CloudError(
    'unsupported_platform',
    'Cloud backup is only available in the installed mobile app.',
  );
}
