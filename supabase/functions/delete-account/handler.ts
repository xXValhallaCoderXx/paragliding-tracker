interface ServiceError { message: string }

/** The service-role operations this handler needs; tests supply an isolated fake. */
export interface DeletionAdmin {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: ServiceError | null }>;
  auth: {
    getUser(token: string): Promise<{ data: { user: { id: string } | null }; error: ServiceError | null }>;
    admin: { deleteUser(id: string): Promise<{ error: ServiceError | null }> };
  };
  storage: {
    from(bucket: string): {
      list(prefix: string, options: { limit: number; offset: number }): Promise<{
        data: { name: string }[] | null; error: ServiceError | null;
      }>;
      remove(paths: string[]): Promise<{ error: ServiceError | null }>;
    };
  };
}

export function createDeleteAccountHandler(dependencies: {
  env(name: string): string | undefined;
  createAdmin(url: string, key: string): DeletionAdmin;
}) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    const authorization = request.headers.get('Authorization');
    const accessToken = authorization?.match(/^Bearer\s+(\S+)\s*$/i)?.[1];
    if (!accessToken) return new Response('Unauthorized', { status: 401 });

    const secretKey = dependencies.env('ACCOUNT_DELETION_SECRET_KEY') ?? dependencies.env('SUPABASE_SERVICE_ROLE_KEY');
    const url = dependencies.env('SUPABASE_URL');
    if (!secretKey || !url) return new Response('Server misconfigured: account deletion is unavailable.', { status: 500 });

    const admin = dependencies.createAdmin(url, secretKey);
    // Only the verified token chooses the owner, never an ID from the request body.
    const { data: { user }, error: callerError } = await admin.auth.getUser(accessToken);
    if (callerError || !user) return new Response('Unauthorized', { status: 401 });

    // Revoke social reads and reject new artifact reservations before listing
    // storage. A live upload must finish (or its bounded lease expire) first.
    const gate = await admin.rpc('social_begin_account_deletion', { p_owner: user.id });
    if (gate.error) return new Response('Could not prepare account deletion. Please retry.', { status: 500 });
    if (gate.data !== true) return new Response('A shared flight upload is finishing. Please retry account deletion shortly.', { status: 409 });

    // Deleting a page shrinks the collection. Always drain its first page, otherwise
    // advancing an offset skips archives. Storage must be empty before auth cascades.
    for (const bucket of ['flight-igc', 'shared-flight-replays']) {
      const archives = admin.storage.from(bucket);
      for (;;) {
        const { data: objects, error: listError } = await archives.list(user.id, { limit: 100, offset: 0 });
        if (listError) return new Response(`Could not list stored files: ${listError.message}`, { status: 500 });
        if (!objects || objects.length === 0) break;

        const { error: removeError } = await archives.remove(objects.map((object) => `${user.id}/${object.name}`));
        if (removeError) return new Response(`Could not delete stored files: ${removeError.message}`, { status: 500 });
      }
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) return new Response(deleteError.message, { status: 500 });
    return new Response(JSON.stringify({ deleted: true }), { headers: { 'Content-Type': 'application/json' } });
  };
}
